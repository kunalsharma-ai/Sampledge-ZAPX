/**
 * Where file bytes live (Milestone 7, S3 in Milestone 13). The database keeps only metadata.
 *
 * FILE_STORE=local (the default) writes under FILES_DIR: one host, or several sharing a volume.
 * FILE_STORE=s3 keeps every file as an object in a private bucket, encrypted at rest with SSE-KMS
 * when S3_KMS_KEY_ID is set and SSE-S3 (AES-256) otherwise. Credentials come from the standard AWS
 * chain (the ECS task role on AWS; environment or profile elsewhere), never from SampCode settings.
 * S3_ENDPOINT points the store at an S3-compatible service (MinIO, LocalStack) for testing.
 */
import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client, type ServerSideEncryption } from '@aws-sdk/client-s3';
import { config } from '../config';
import { integration } from '../platform/integrations';

export abstract class FileStore {
  abstract put(key: string, data: Buffer, contentType?: string): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
}

/** Keys are made by SampCode itself; anything else is refused before it reaches a disk or a bucket. */
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

export interface S3Settings {
  bucket: string;
  region: string;
  prefix?: string;
  kmsKeyId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/** The S3 settings in use: Settings > Integrations first, then the S3_* variables. */
export function s3Settings(): S3Settings {
  const v = integration('s3').values;
  return {
    bucket: v.bucket ?? '',
    region: v.region || config().S3_REGION,
    prefix: v.prefix || undefined,
    kmsKeyId: v.kmsKeyId || undefined,
    accessKeyId: v.accessKeyId || undefined,
    secretAccessKey: v.secretAccessKey || undefined,
  };
}

@Injectable()
export class S3FileStore extends FileStore {
  private readonly log = new Logger('S3FileStore');
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly kmsKeyId: string | undefined;
  constructor(client?: S3Client, settings: S3Settings = s3Settings()) {
    super();
    if (!settings.bucket) throw new Error('S3 storage needs a bucket (Settings > Integrations, or S3_BUCKET)');
    this.client = client ?? S3FileStore.client(settings);
    this.bucket = settings.bucket;
    this.prefix = settings.prefix ? `${settings.prefix.replace(/\/+$/, '')}/` : '';
    this.kmsKeyId = settings.kmsKeyId;
    this.log.log(`Files are stored in s3://${this.bucket}/${this.prefix} (${this.kmsKeyId ? 'SSE-KMS' : 'SSE-S3'})`);
  }
  private readonly client: S3Client;

  static client(settings: S3Settings = s3Settings()) {
    const c = config();
    return new S3Client({
      region: settings.region,
      ...(c.S3_ENDPOINT ? { endpoint: c.S3_ENDPOINT, forcePathStyle: true } : {}),
      ...(settings.accessKeyId && settings.secretAccessKey
        ? { credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey } }
        : {}),
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

/** The store in use right now: S3 when it is on in Settings > Integrations (or FILE_STORE=s3), else local. */
export function fileStoreFromConfig(): FileStore {
  return integration('s3').enabled ? new S3FileStore() : new LocalFileStore();
}

/**
 * The FileStore the API and the worker use: follows Settings > Integrations, rebuilding the S3 client
 * when the bucket, keys or switch change. Files are not moved when storage is switched.
 */
@Injectable()
export class SwitchingFileStore extends FileStore {
  private built?: { fingerprint: string; store: FileStore };

  current(): FileStore {
    const s = integration('s3');
    const fingerprint = `${s.fingerprint}|${config().FILES_DIR}`;
    if (this.built?.fingerprint !== fingerprint) this.built = { fingerprint, store: fileStoreFromConfig() };
    return this.built.store;
  }
  put(key: string, data: Buffer, contentType?: string) {
    return this.current().put(key, data, contentType);
  }
  get(key: string) {
    return this.current().get(key);
  }
  delete(key: string) {
    return this.current().delete(key);
  }
}
