import type { Request, Response } from 'express';

/**
 * Send a file held in memory, honouring a single byte range (browsers need ranges to seek in audio
 * and video). Headers other than the range ones are the caller's.
 */
export function sendBytes(req: Request, res: Response, data: Buffer) {
  res.setHeader('Accept-Ranges', 'bytes');
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : data.length - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : data.length - 1;
    start = Math.max(0, start);
    end = Math.min(end, data.length - 1);
    if (start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${data.length}`).end();
      return;
    }
    res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
    res.setHeader('Content-Length', String(end - start + 1));
    res.end(data.subarray(start, end + 1));
    return;
  }
  res.setHeader('Content-Length', String(data.length));
  res.end(data);
}

/** True unless the request asks for a range that starts after the first byte. */
export function isFirstRead(req: Request): boolean {
  const m = /^bytes=(\d*)-/.exec(String(req.headers.range ?? ''));
  return !m || m[1] === '' || m[1] === '0';
}
