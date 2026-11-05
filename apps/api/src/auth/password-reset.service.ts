/**
 * Password change and reset (security fix after the maintainer handbook review).
 *
 * - A member changes their own password with the current one (AuthController.changePassword).
 * - An administrator creates a one-time reset link for a member (UsersController.resetLink). The
 *   link is shown to the administrator once and, when email is set up, also emailed to the member.
 * - "Forgot password" emails a link to the member when email is set up (AuthController.forgot).
 *
 * Only a SHA-256 hash of a reset token is stored. A link works once, for PASSWORD_RESET_HOURS, and
 * a new link voids the member's older unused ones. Every password change signs out the member's
 * other sessions (sessionsRevokedAt) and clears an account lockout.
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config';
import { PrismaService } from '../common/prisma.service';
import { emailProvider } from '../distribution/mailer';
import { isCommonPassword } from './password-policy';

export const newPasswordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .refine((p) => !isCommonPassword(p), 'This password is too common. Choose another one.');

export const INVALID_RESET = 'This reset link is invalid or has expired. Ask for a new one.';

/** Self-service links for one member are not emailed more often than this, so the form cannot flood an inbox. */
const FORGOT_COOLDOWN_MS = 2 * 60_000;

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class PasswordResetService {
  private readonly log = new Logger('PasswordReset');

  constructor(private readonly prisma: PrismaService) {}

  /** Creates a reset link, voiding the member's older unused links. Returns the link and its expiry. */
  async create(user: { id: string; tenantId: string }, createdById: string | null) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + config().PASSWORD_RESET_HOURS * 3600_000);
    await this.prisma.$transaction([
      this.prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordReset.create({
        data: { tenantId: user.tenantId, userId: user.id, tokenHash: tokenHash(token), expiresAt, createdById },
      }),
    ]);
    return { url: `${config().STUDIO_URL.replace(/\/$/, '')}/reset-password?token=${token}`, expiresAt };
  }

  /** True when a self-service link was created for this member within the cooldown. */
  async recentlySent(userId: string) {
    const last = await this.prisma.passwordReset.findFirst({
      where: { userId, createdById: null, createdAt: { gt: new Date(Date.now() - FORGOT_COOLDOWN_MS) } },
      select: { id: true },
    });
    return !!last;
  }

  /** Emails the link when an email provider is configured. Returns whether it was sent. */
  async email(to: { email: string; name: string }, url: string, expiresAt: Date, byAdmin: boolean): Promise<boolean> {
    const provider = emailProvider();
    if (!provider) return false;
    const hours = config().PASSWORD_RESET_HOURS;
    const text = [
      `Hello ${to.name},`,
      '',
      byAdmin
        ? 'An administrator of your ZAPX organization created a link for you to set a new password.'
        : 'Someone asked to reset the password of your ZAPX account. If it was not you, ignore this email.',
      '',
      `Set a new password: ${url}`,
      '',
      `The link works once and expires in ${hours} hour${hours === 1 ? '' : 's'} (${expiresAt.toISOString()}).`,
    ].join('\n');
    try {
      await provider.send({ to, subject: 'Reset your ZAPX password', text }, AbortSignal.timeout(15_000));
      return true;
    } catch (e) {
      this.log.warn(`Could not email a password reset link: ${(e as Error).message}`);
      return false;
    }
  }

  /** Sets a new password from a reset token. Throws 400 for an unknown, used or expired token. */
  async consume(token: string, password: string) {
    const row = await this.prisma.passwordReset.findUnique({ where: { tokenHash: tokenHash(token) } });
    if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) throw new BadRequestException(INVALID_RESET);
    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || user.tenantId !== row.tenantId || user.disabledAt) throw new BadRequestException(INVALID_RESET);
    const passwordHash = await hash(password, 10);
    const now = new Date();
    // Marking the link used inside the same transaction (and only while still unused) means two
    // simultaneous requests with one link cannot both set a password.
    await this.prisma.$transaction(async (tx) => {
      const used = await tx.passwordReset.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
      if (used.count !== 1) throw new BadRequestException(INVALID_RESET);
      await tx.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, failedLogins: 0, lockedUntil: null, sessionsRevokedAt: now },
      });
    });
    return user;
  }
}
