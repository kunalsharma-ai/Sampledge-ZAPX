import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { StoredFile } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';
import { FileStore } from './file-store';

export interface SaveFile {
  tenantId: string;
  surveyId?: string | null;
  jobId?: string | null;
  purpose: 'export' | 'upload';
  name: string;
  contentType: string;
  data: Buffer;
  ttlMs: number;
  createdById?: string | null;
}

/** Stored files: metadata in Postgres, bytes in the FileStore, always with an expiry. */
@Injectable()
export class FilesService {
  private readonly log = new Logger('Files');

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: FileStore,
  ) {}

  async save(f: SaveFile): Promise<StoredFile> {
    // Unguessable key, grouped by tenant; never derived from the file name.
    const storageKey = `${f.tenantId}/${new Date().toISOString().slice(0, 10)}/${randomBytes(16).toString('hex')}`;
    await this.store.put(storageKey, f.data);
    return this.prisma.storedFile.create({
      data: {
        tenantId: f.tenantId,
        surveyId: f.surveyId ?? null,
        jobId: f.jobId ?? null,
        purpose: f.purpose,
        name: f.name.slice(0, 200),
        contentType: f.contentType,
        size: f.data.length,
        sha256: createHash('sha256').update(f.data).digest('hex'),
        storageKey,
        expiresAt: new Date(Date.now() + f.ttlMs),
        createdById: f.createdById ?? null,
      },
    });
  }

  /** A live (not deleted, not expired) file of this tenant. */
  async find(tenantId: string, id: string): Promise<StoredFile> {
    const file = await this.prisma.storedFile.findFirst({ where: { id, tenantId, deletedAt: null, expiresAt: { gt: new Date() } } });
    if (!file) throw new NotFoundException('This file has expired or does not exist');
    return file;
  }

  bytes(file: StoredFile): Promise<Buffer> {
    return this.store.get(file.storageKey);
  }

  async read(tenantId: string, id: string): Promise<{ file: StoredFile; data: Buffer }> {
    const file = await this.find(tenantId, id);
    return { file, data: await this.bytes(file) };
  }

  /** Delete expired files (bytes first, then mark the row). Returns how many were removed. */
  async purgeExpired(limit = 500): Promise<number> {
    const due = await this.prisma.storedFile.findMany({ where: { deletedAt: null, expiresAt: { lte: new Date() } }, take: limit });
    for (const f of due) {
      try {
        await this.store.delete(f.storageKey);
        await this.prisma.storedFile.update({ where: { id: f.id }, data: { deletedAt: new Date() } });
      } catch (e) {
        this.log.error(`Could not delete expired file ${f.id}: ${(e as Error).message}`);
      }
    }
    return due.length;
  }
}
