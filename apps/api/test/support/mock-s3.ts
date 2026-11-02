/**
 * A minimal S3-compatible server for tests (Milestone 13). It keeps objects in memory and records the
 * requests the real AWS SDK sends (path-style PUT, GET and DELETE), so tests can check the bucket, the
 * key, the encryption headers and that every request is SigV4-signed. It is not S3: no listing,
 * multipart, versioning or signature verification.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface S3Request {
  method: string;
  bucket: string;
  key: string;
  headers: IncomingMessage['headers'];
}

export class MockS3 {
  endpoint = '';
  objects = new Map<string, { body: Buffer; contentType: string; headers: IncomingMessage['headers'] }>();
  requests: S3Request[] = [];
  /** Answer the next request with this status (for error handling tests). */
  failNext?: number;
  private server?: Server;

  async start() {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://x');
        const [, bucket = '', ...rest] = url.pathname.split('/');
        const key = decodeURIComponent(rest.join('/'));
        this.requests.push({ method: req.method ?? '', bucket, key, headers: req.headers });
        const id = `${bucket}/${key}`;
        if (this.failNext) {
          res.writeHead(this.failNext, { 'Content-Type': 'application/xml' }).end('<Error><Code>InternalError</Code></Error>');
          this.failNext = undefined;
          return;
        }
        if (req.method === 'PUT') {
          let body = Buffer.concat(chunks);
          // The SDK may send aws-chunked bodies with a trailing checksum; unwrap them.
          if (String(req.headers['content-encoding'] ?? '').includes('aws-chunked')) body = unchunk(body);
          this.objects.set(id, { body, contentType: String(req.headers['content-type'] ?? ''), headers: req.headers });
          res.writeHead(200, { ETag: '"etag"' }).end();
        } else if (req.method === 'GET') {
          const o = this.objects.get(id);
          if (!o) {
            res
              .writeHead(404, { 'Content-Type': 'application/xml' })
              .end('<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>');
            return;
          }
          res.writeHead(200, { 'Content-Type': o.contentType, 'Content-Length': o.body.length }).end(o.body);
        } else if (req.method === 'DELETE') {
          this.objects.delete(id);
          res.writeHead(204).end();
        } else res.writeHead(405).end();
      });
    });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.endpoint = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  stop() {
    return new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }
}

function unchunk(b: Buffer): Buffer {
  const out: Buffer[] = [];
  let i = 0;
  for (;;) {
    const eol = b.indexOf('\r\n', i);
    if (eol < 0) break;
    const size = parseInt(b.subarray(i, eol).toString().split(';')[0]!, 16);
    if (!size) break;
    out.push(b.subarray(eol + 2, eol + 2 + size));
    i = eol + 2 + size + 2;
  }
  return Buffer.concat(out);
}
