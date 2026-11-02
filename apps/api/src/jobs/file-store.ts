/**
 * Where file bytes live (Milestone 7, S3 in Milestone 13). The database keeps only metadata.
 *
 * FILE_STORE=local (the default) writes under FILES_DIR: one host, or several sharing a volume.
 * FILE_STORE=s3 keeps every file as an object in a private bucket, encrypted at rest with SSE-KMS
 * when S3_KMS_KEY_ID is set and SSE-S3 (AES-256) otherwise. Credentials come from the standard AWS
 * chain (the ECS task role on AWS; environment or profile elsewhere), never from ZAPX settings.
 * S3_ENDPOINT points the store at an S3-compatible service (MinIO, LocalStack) for testing.
 */
import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client, type ServerSideEncryption } from '@aws-sdk/client-s3';
import { config } from '../config';

export abstract class FileStore {
  abstract put(key: string, data: Buffer, contentType?: string): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
}

/** Keys are made by ZAPX itself; anything else is refused before it reaches a disk or a bucket. */
export function checkKey(key: string) {
  if (!/^[A-Za-z0-9/_-]+$/.test(key) || key.includes('..') || key.startsWith('/')) throw new Error('Invalid storage key');
  return key;
}

@Injectable()
export class LocalFileStore extends FileStore {
  private readonly root = resolve(config().FILES_DIR);

  private path(key: string) {
    const p = resolve(this.root, checkKey(key));
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

/** Raised by get() when the object does not exist, like ENOENT from the local store. */
export class FileNotFoundError extends Error {
  code = 'ENOENT';
}

@Injectable()
export class S3FileStore extends FileStore {
  private readonly log = new Logger('S3FileStore');
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly kmsKeyId: string | undefined;
  constructor(private readonly client: S3Client = S3FileStore.client()) {
    super();
    const c = config();
    if (!c.S3_BUCKET) throw new Error('FILE_STORE=s3 needs S3_BUCKET');
    this.bucket = c.S3_BUCKET;
    this.prefix = c.S3_PREFIX ? `${c.S3_PREFIX.replace(/\/+$/, '')}/` : '';
    this.kmsKeyId = c.S3_KMS_KEY_ID;
    this.log.log(`Files are stored in s3://${this.bucket}/${this.prefix} (${this.kmsKeyId ? 'SSE-KMS' : 'SSE-S3'})`);
  }

  static client() {
    const c = config();
    return new S3Client({
      region: c.S3_REGION,
      ...(c.S3_ENDPOINT ? { endpoint: c.S3_ENDPOINT, forcePathStyle: true } : {}),
      maxAttempts: 3,
    });
  }

  private key(key: string) {
    return this.prefix + checkKey(key);
  }

  async put(key: string, data: Buffer, contentType = 'application/octet-stream') {
    const encryption: { ServerSideEncryption: ServerSideEncryption; SSEKMSKeyId?: string } = this.kmsKeyId
      ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: this.kmsKeyId }
      : { ServerSideEncryption: 'AES256' };
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.key(key), Body: data, ContentType: contentType, ...encryption }),
    );
  }

  async get(key: string) {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      if (!out.Body) throw new FileNotFoundError(key);
      return Buffer.from(await out.Body.transformToByteArray());
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') throw new FileNotFoundError(key);
      throw e;
    }
  }

  async delete(key: string) {
    // S3 answers 204 for a missing key too, so deleting twice is fine (like rm --force).
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
  }
}

/** The store FILE_STORE selects; used by the API, the worker and the CLI alike. */
export function fileStoreFromConfig(): FileStore {
  return config().FILE_STORE === 's3' ? new S3FileStore() : new LocalFileStore();
}
