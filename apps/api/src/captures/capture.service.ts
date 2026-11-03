/**
 * Photos and interview recordings (Milestone 12).
 *
 * Unlike survey media, captures come from respondents and interviewers and can show people, homes
 * and voices. They are never public: only people who can see the survey open them, every view is
 * audited, an administrator can erase all of a survey's captures, and CAPTURE_RETENTION_DAYS deletes
 * them automatically. The file type is decided from the bytes, never from the browser's claim.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@zapx/db';
import { allQuestions, CAPTURE_REF, type Answers, type SurveyDefinition } from '@zapx/survey-schema';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SurveysService } from '../surveys/surveys.service';
import { FileStore } from '../jobs/file-store';
import { sniffMedia } from '../media/media.service';
import { config } from '../config';
import { integration } from '../platform/integrations';
import type { AuthUser } from '../auth/auth.types';

export type CaptureKind = 'photo' | 'audio';

/** Photos larger than this are refused (phone cameras produce 2 to 8 MB). */
export const PHOTO_MAX_MB = 15;
/** One interview cannot collect more files than this. */
const MAX_PER_INTERVIEW = 50;
/** The reference of the interview recording (photo references are random). */
export const AUDIO_REF = 'audio';

const PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const AUDIO_TYPES = new Set(['video/webm', 'audio/ogg', 'audio/mp4', 'video/mp4', 'audio/mpeg', 'audio/wav']);

/** Check the bytes and size of a capture; returns the content type to serve it with. */
export function checkCapture(kind: CaptureKind, data: Buffer): string {
  const t = sniffMedia(data);
  if (kind === 'photo') {
    if (!t || !PHOTO_TYPES.has(t.contentType)) throw new BadRequestException('Upload a JPEG, PNG or WebP photo');
    if (data.length > PHOTO_MAX_MB * 1024 * 1024) throw new PayloadTooLargeException(`Photos can be up to ${PHOTO_MAX_MB} MB`);
    return t.contentType;
  }
  if (!t || !AUDIO_TYPES.has(t.contentType)) throw new BadRequestException('Upload the recording as WebM, Ogg, MP4, MP3 or WAV');
  if (data.length > config().CAPTURE_MAX_MB * 1024 * 1024)
    throw new PayloadTooLargeException(`Recordings can be up to ${config().CAPTURE_MAX_MB} MB`);
  // WebM and MP4 recordings from MediaRecorder hold audio only; serve them as audio.
  return t.contentType === 'video/webm' ? 'audio/webm' : t.contentType === 'video/mp4' ? 'audio/mp4' : t.contentType;
}

export interface CaptureView {
  id: string;
  kind: CaptureKind;
  ref: string;
  contentType: string;
  size: number;
  createdAt: Date;
  url: string;
  /** Recordings: the transcript, once a reviewer asked for one (Milestone 17). */
  transcript?: { text: string; language: string | null; at: Date } | null;
}

@Injectable()
export class CaptureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: FileStore,
    private readonly audit: AuditService,
    private readonly surveys: SurveysService,
  ) {}

  private async save(
    data: Buffer,
    kind: CaptureKind,
    contentType: string,
    row: { tenantId: string; surveyId: string; responseId?: string; clientId?: string; ref: string; uploadedById?: string },
  ) {
    const id = randomBytes(16).toString('base64url');
    const storageKey = `${row.tenantId}/captures/${id}`;
    await this.store.put(storageKey, data, contentType);
    try {
      return await this.prisma.capture.create({
        data: { ...row, id, kind, contentType, size: data.length, sha256: createHash('sha256').update(data).digest('hex'), storageKey },
      });
    } catch (e) {
      await this.store.delete(storageKey);
      throw e;
    }
  }

  /**
   * The recording of a dialer call (Milestone 19), kept with the interview. Idempotent by reference.
   */
  async saveCallRecording(
    row: { tenantId: string; surveyId: string; responseId: string; ref: string; uploadedById: string },
    data: Buffer,
    contentType: string,
  ) {
    const existing = await this.prisma.capture.findUnique({ where: { responseId_ref: { responseId: row.responseId, ref: row.ref } } });
    if (existing) return existing;
    return this.save(data, 'audio', contentType, row);
  }

  /**
   * A respondent's photo answer, uploaded while the interview is in progress. Returns the reference
   * to submit as the answer. The question must be a photo question of the survey.
   */
  async uploadForResponse(
    r: { id: string; tenantId: string; surveyId: string; status: string },
    def: SurveyDefinition,
    questionId: string,
    data: Buffer,
  ) {
    if (r.status !== 'IN_PROGRESS') throw new ConflictException('This interview has already finished.');
    const q = allQuestions(def).find((x) => x.id === questionId);
    if (!q || q.type !== 'photo') throw new BadRequestException('This question does not take a photo');
    const contentType = checkCapture('photo', data);
    const count = await this.prisma.capture.count({ where: { responseId: r.id } });
    if (count >= MAX_PER_INTERVIEW) throw new ConflictException('Too many photos for one interview');
    const ref = randomBytes(12).toString('base64url');
    await this.save(data, 'photo', contentType, { tenantId: r.tenantId, surveyId: r.surveyId, responseId: r.id, ref });
    return { ref };
  }

  /**
   * CAPI: a photo or the recording of an interview, uploaded by the interviewer's app before the
   * interview itself syncs. Idempotent by (interview, reference), so a retried upload is a no-op.
   */
  async uploadFromDevice(user: AuthUser, input: { clientId: string; surveyId: string; ref: string; kind: CaptureKind }, data: Buffer) {
    if (input.kind === 'photo' ? !CAPTURE_REF.test(input.ref) : input.ref !== AUDIO_REF)
      throw new BadRequestException('Invalid capture reference');
    const assignment = await this.prisma.capiAssignment.findUnique({
      where: { surveyId_interviewerId: { surveyId: input.surveyId, interviewerId: user.id } },
    });
    if (!assignment || assignment.tenantId !== user.tenantId) throw new ForbiddenException('You are not assigned to this survey.');
    const existing = await this.prisma.capture.findUnique({ where: { clientId_ref: { clientId: input.clientId, ref: input.ref } } });
    if (existing) {
      if (existing.tenantId !== user.tenantId || existing.uploadedById !== user.id)
        throw new ForbiddenException('This interview belongs to another interviewer.');
      return { id: existing.id, ref: existing.ref, stored: false };
    }
    // The interview may already have synced (photos are retried after the answers).
    const response = await this.prisma.response.findUnique({ where: { clientId: input.clientId } });
    if (response && (response.tenantId !== user.tenantId || response.interviewerId !== user.id))
      throw new ForbiddenException('This interview belongs to another interviewer.');
    if ((await this.prisma.capture.count({ where: { clientId: input.clientId } })) >= MAX_PER_INTERVIEW)
      throw new ConflictException('Too many files for one interview');
    const contentType = checkCapture(input.kind, data);
    try {
      const c = await this.save(data, input.kind, contentType, {
        tenantId: user.tenantId,
        surveyId: input.surveyId,
        clientId: input.clientId,
        responseId: response?.id,
        ref: input.ref,
        uploadedById: user.id,
      });
      return { id: c.id, ref: c.ref, stored: true };
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        const again = await this.prisma.capture.findUnique({ where: { clientId_ref: { clientId: input.clientId, ref: input.ref } } });
        if (again) return { id: again.id, ref: again.ref, stored: false };
      }
      throw e;
    }
  }

  /** CAPI: attach the files uploaded for an interview to its stored response. */
  async link(tenantId: string, clientId: string, responseId: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    await db.capture.updateMany({ where: { tenantId, clientId, responseId: null }, data: { responseId } });
  }

  /** Photo questions whose answer points at no stored file (an upload that has not arrived, or a forged reference). */
  async missingPhotos(def: SurveyDefinition, answers: Answers, where: { responseId?: string; clientId?: string }): Promise<string[]> {
    const asked = allQuestions(def)
      .filter((q) => q.type === 'photo')
      .map((q) => ({ id: q.id, ref: answers[q.id] }))
      .filter((x): x is { id: string; ref: string } => typeof x.ref === 'string');
    if (asked.length === 0) return [];
    const found = await this.prisma.capture.findMany({
      where: { ...where, kind: 'photo', ref: { in: asked.map((a) => a.ref) }, deletedAt: null },
      select: { ref: true },
    });
    const have = new Set(found.map((f) => f.ref));
    return asked.filter((a) => !have.has(a.ref)).map((a) => a.id);
  }

  /** Online: remove photos the respondent replaced, once the interview has finished. */
  async settle(responseId: string, def: SurveyDefinition, answers: Answers) {
    const keep = new Set(
      allQuestions(def)
        .filter((q) => q.type === 'photo')
        .map((q) => answers[q.id])
        .filter((v): v is string => typeof v === 'string'),
    );
    const unused = await this.prisma.capture.findMany({ where: { responseId, kind: 'photo', deletedAt: null, ref: { notIn: [...keep] } } });
    for (const c of unused) await this.drop(c);
  }

  private async drop(c: { id: string; storageKey: string }) {
    await this.store.delete(c.storageKey);
    await this.prisma.capture.update({
      where: { id: c.id },
      data: { deletedAt: new Date(), transcript: null, transcriptLanguage: null, transcribedAt: null },
    });
  }

  view(c: {
    id: string;
    kind: string;
    ref: string;
    contentType: string;
    size: number;
    createdAt: Date;
    transcript?: string | null;
    transcriptLanguage?: string | null;
    transcribedAt?: Date | null;
  }): CaptureView {
    return {
      id: c.id,
      kind: c.kind as CaptureKind,
      ref: c.ref,
      contentType: c.contentType,
      size: c.size,
      createdAt: c.createdAt,
      url: `/api/captures/${c.id}`,
      ...(c.kind === 'audio'
        ? { transcript: c.transcribedAt ? { text: c.transcript ?? '', language: c.transcriptLanguage ?? null, at: c.transcribedAt } : null }
        : {}),
    };
  }

  /** Captures of several responses, for the review queue. */
  async ofResponses(tenantId: string, ids: string[]): Promise<Map<string, CaptureView[]>> {
    const rows = ids.length
      ? await this.prisma.capture.findMany({
          where: { tenantId, responseId: { in: ids }, deletedAt: null },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const out = new Map<string, CaptureView[]>();
    for (const c of rows) out.set(c.responseId!, [...(out.get(c.responseId!) ?? []), this.view(c)]);
    return out;
  }

  /** Open one capture. Audited, because it may show a person or carry their voice. */
  async open(user: AuthUser, id: string, firstView: boolean) {
    const c = /^[A-Za-z0-9_-]{10,64}$/.test(id)
      ? await this.prisma.forTenant(user.tenantId).capture.findFirst({ where: { id, tenantId: user.tenantId, deletedAt: null } })
      : null;
    if (!c) throw new NotFoundException('Not found');
    await this.surveys.getSurvey(user, c.surveyId);
    // Audio players fetch a file in many byte ranges; one view is audited, not every range.
    if (firstView)
      await this.audit.record(user, 'capture.view', 'response', c.responseId ?? c.clientId ?? c.id, { captureId: c.id, kind: c.kind });
    return { meta: c, data: await this.store.get(c.storageKey) };
  }

  /** Erase every photo and recording of a survey (administrators). Answers keep their references. */
  async eraseSurvey(user: AuthUser, surveyId: string) {
    await this.surveys.getSurvey(user, surveyId);
    const rows = await this.prisma.capture.findMany({ where: { tenantId: user.tenantId, surveyId, deletedAt: null } });
    for (const c of rows) await this.drop(c);
    await this.audit.record(user, 'capture.erase', 'survey', surveyId, { erased: rows.length });
    return { erased: rows.length };
  }

  async countOf(user: AuthUser, surveyId: string) {
    await this.surveys.getSurvey(user, surveyId);
    const rows = await this.prisma.capture.groupBy({
      by: ['kind'],
      where: { tenantId: user.tenantId, surveyId, deletedAt: null },
      _count: true,
      _sum: { size: true },
    });
    return {
      photos: rows.find((r) => r.kind === 'photo')?._count ?? 0,
      recordings: rows.find((r) => r.kind === 'audio')?._count ?? 0,
      bytes: rows.reduce((n, r) => n + (r._sum.size ?? 0), 0),
      retentionDays: config().CAPTURE_RETENTION_DAYS,
      transcription: {
        enabled: integration('deepgram').enabled,
        transcribed: await this.prisma.capture.count({
          where: { tenantId: user.tenantId, surveyId, kind: 'audio', deletedAt: null, transcribedAt: { not: null } },
        }),
      },
    };
  }

  /** Housekeeping: apply CAPTURE_RETENTION_DAYS. */
  async purgeExpired(): Promise<number> {
    const days = config().CAPTURE_RETENTION_DAYS;
    if (!days) return 0;
    const rows = await this.prisma.capture.findMany({
      where: { deletedAt: null, createdAt: { lt: new Date(Date.now() - days * 86_400_000) } },
      take: 1000,
    });
    for (const c of rows) await this.drop(c);
    return rows.length;
  }
}
