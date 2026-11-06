/**
 * Encrypts secrets that SampCode must be able to read back (e.g. a partner's client secret) with
 * AES-256-GCM. Format: "v1.<iv>.<tag>.<ciphertext>" (base64url). The key comes from SECRETS_KEY.
 *
 * This is the seam for AWS KMS: a KmsSecretBox with the same interface can wrap a data key with
 * KMS (envelope encryption) without touching callers. See docs/adr/0005-aws-deployment.md.
 */
import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config';

export abstract class SecretBox {
  abstract seal(plain: string): string;
  abstract open(sealed: string): string;
}

@Injectable()
export class LocalSecretBox extends SecretBox {
  private readonly key: Buffer;

  constructor() {
    super();
    const cfg = config();
    this.key = createHash('sha256')
      .update(`zapx-secret-box:${cfg.SECRETS_KEY ?? cfg.JWT_SECRET}`)
      .digest();
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
  }

  open(sealed: string): string {
    const [v, iv, tag, data] = sealed.split('.');
    if (v !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unsupported sealed secret');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }
}
