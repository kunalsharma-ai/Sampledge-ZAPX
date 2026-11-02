import { BadRequestException, ConflictException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { mediaIdsOf, type MediaKind, type SurveyDefinition } from '@zapx/survey-schema';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SurveysService } from '../surveys/surveys.service';
import { FileStore } from '../jobs/file-store';
import { config } from '../config';
import type { AuthUser } from '../auth/auth.types';

/** Largest file per kind, in MB (videos also capped by MEDIA_MAX_MB). */
const KIND_MAX_MB: Record<MediaKind, number> = { image: 10, audio: 25, video: 200 };

/**
 * The file's real type, from its first bytes. The browser's claimed type and the file name are not
 * trusted, and SVG (which can carry script) is not accepted.
 */
export function sniffMedia(b: Buffer): { kind: MediaKind; contentType: string } | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((x, k) => b[i + k] === x);
  const ascii = (i: number, s: string) => b.subarray(i, i + s.length).toString('latin1') === s;
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { kind: 'image', contentType: 'image/png' };
  if (at(0, 0xff, 0xd8, 0xff)) return { kind: 'image', contentType: 'image/jpeg' };
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return { kind: 'image', contentType: 'image/gif' };
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { kind: 'image', contentType: 'image/webp' };
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return { kind: 'audio', contentType: 'audio/wav' };
  if (ascii(0, 'OggS')) return { kind: 'audio', contentType: 'audio/ogg' };
  if (ascii(0, 'ID3') || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0)) return { kind: 'audio', contentType: 'audio/mpeg' };
  if (ascii(4, 'ftyp')) {
    const brand = b.subarray(8, 12).toString('latin1');
    if (brand.startsWith('M4A')) return { kind: 'audio', contentType: 'audio/mp4' };
    if (brand === 'qt  ') return null; // QuickTime .mov does not play in most browsers
    return { kind: 'video', contentType: 'video/mp4' };
  }
  // WebM/Matroska (EBML header). Audio-only WebM is treated as video; browsers play both.
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return { kind: 'video', contentType: 'video/webm' };
  return null;
}

/** Media files for surveys: uploaded in the studio, served to respondents by unguessable id. */
@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly surveys: SurveysService,
    private readonly store: FileStore,
    private readonly audit: AuditService,
  ) {}

  private view(m: { id: string; kind: string; name: string; contentType: string; size: number; createdAt: Date }) {
    return {
      id: m.id,
      kind: m.kind,
      name: m.name,
      contentType: m.contentType,
      size: m.size,
      createdAt: m.createdAt,
      url: `/api/public/media/${m.id}`,
    };
  }

  async upload(user: AuthUser, surveyId: string, name: string, data: Buffer) {
    await this.surveys.getSurvey(user, surveyId);
    const type = sniffMedia(data);
    if (!type) throw new BadRequestException('Upload a PNG, JPEG, WebP or GIF image, an MP4 or WebM video, or MP3, M4A, OGG or WAV audio');
    const max = Math.min(KIND_MAX_MB[type.kind], config().MEDIA_MAX_MB);
    if (data.length > max * 1024 * 1024)
      throw new PayloadTooLargeException(`${type.kind[0]!.toUpperCase()}${type.kind.slice(1)} files can be up to ${max} MB`);
    const id = randomBytes(16).toString('base64url');
    const storageKey = `${user.tenantId}/media/${id}`;
    await this.store.put(storageKey, data, type.contentType);
    const m = await this.prisma.mediaAsset.create({
      data: {
        id,
        tenantId: user.tenantId,
        surveyId,
        kind: type.kind,
        name: name.replace(/[^\p{L}\p{N} ._()-]+/gu, '_').slice(0, 200) || 'file',
        contentType: type.contentType,
        size: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
        storageKey,
        createdById: user.id,
      },
    });
    await this.audit.record(user, 'media.upload', 'survey', surveyId, { mediaId: id, kind: type.kind, size: data.length });
    return this.view(m);
  }

  async list(user: AuthUser, surveyId: string) {
    await this.surveys.getSurvey(user, surveyId);
    const rows = await this.prisma.mediaAsset.findMany({
      where: { tenantId: user.tenantId, surveyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((m) => this.view(m));
  }

  /** Delete a file no version of its survey uses (published versions keep theirs forever). */
  async remove(user: AuthUser, id: string) {
    const m = await this.prisma.mediaAsset.findFirst({ where: { id, tenantId: user.tenantId, deletedAt: null } });
    if (!m) throw new NotFoundException('Media not found');
    await this.surveys.getSurvey(user, m.surveyId);
    const versions = await this.prisma.surveyVersion.findMany({
      where: { surveyId: m.surveyId },
      select: { version: true, definition: true },
    });
    const using = versions.filter((v) => mediaIdsOf(v.definition as unknown as SurveyDefinition).includes(id)).map((v) => v.version);
    if (using.length)
      throw new ConflictException(`This file is used by version ${using.join(', ')}; remove it from the questionnaire first.`);
    await this.store.delete(m.storageKey);
    await this.prisma.mediaAsset.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record(user, 'media.delete', 'survey', m.surveyId, { mediaId: id });
  }

  /** For respondents: any live media file, by id. */
  async publicFile(id: string) {
    const m = /^[A-Za-z0-9_-]{10,64}$/.test(id) ? await this.prisma.mediaAsset.findFirst({ where: { id, deletedAt: null } }) : null;
    if (!m) throw new NotFoundException('Not found');
    return { meta: m, data: await this.store.get(m.storageKey) };
  }
}
