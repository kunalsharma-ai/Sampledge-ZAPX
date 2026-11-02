/**
 * Where file bytes live (Milestone 7). The database keeps only metadata (StoredFile).
 *
 * LocalFileStore writes under FILES_DIR and is what runs locally and in tests. It is the seam for
 * object storage: an S3FileStore with the same three methods (PutObject, GetObject, DeleteObject on
 * a private bucket with SSE-KMS) replaces it without touching callers. That adapter is not written
 * yet, so production on several hosts needs a shared volume until it is (docs/adr/0013).
 */
import { Injectable } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { config } from '../config';

export abstract class FileStore {
  abstract put(key: string, data: Buffer): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
}

@Injectable()
export class LocalFileStore extends FileStore {
  private readonly root = resolve(config().FILES_DIR);

  private path(key: string) {
    if (!/^[A-Za-z0-9/_-]+$/.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return p;
  }

  async put(key: string, data: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true, mode: 0o700 });
    await writeFile(p, data, { mode: 0o600 });
  }

  get(key: string) {
    return readFile(this.path(key));
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}
