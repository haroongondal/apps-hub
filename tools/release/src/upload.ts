import { request as httpsRequest } from 'node:https';

// One request body is capped near 100 MB on Cloudflare, so anything bigger than a part goes up in parts
// (the Worker's multipart routes under /admin/). R2 wants equal-sized parts except the last.
export const PART_BYTES = 32 * 1024 * 1024;

type Part = { partNumber: number; etag: string };
export type Send = (method: string, url: string, headers: Record<string, string>, body: Buffer) => Promise<{ status: number; text: string }>;

// node:https has no headers timeout (fetch's undici gives up after 5 minutes, too short on a slow uplink).
export const httpsSend: Send = (method, url, headers, body) =>
  new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method, headers: { ...headers, 'content-length': body.length } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString() }));
    });
    req.setTimeout(0);
    req.on('error', reject);
    req.end(body);
  });

export function makeUploader(api: string, token: string, send: Send = httpsSend, partBytes = PART_BYTES) {
  async function call(method: string, path: string, headers: Record<string, string>, body: Buffer): Promise<string> {
    const { status, text } = await send(method, `${api}/admin/${path}`, { authorization: `Bearer ${token}`, ...headers }, body);
    if (status < 200 || status > 299) throw new Error(`${method} ${path}: ${status} ${text}`);
    return text;
  }

  return async function upload(key: string, body: Buffer | string, contentType: string): Promise<void> {
    const bytes = typeof body === 'string' ? Buffer.from(body) : body;
    if (bytes.length <= partBytes) {
      await call('PUT', key, { 'content-type': contentType }, bytes);
      return;
    }
    const { uploadId } = JSON.parse(await call('POST', `${key}?uploads`, { 'content-type': contentType }, Buffer.alloc(0))) as { uploadId: string };
    const parts: Part[] = [];
    for (let at = 0, n = 1; at < bytes.length; at += partBytes, n++) {
      const text = await call('PUT', `${key}?uploadId=${uploadId}&part=${n}`, {}, bytes.subarray(at, at + partBytes));
      parts.push(JSON.parse(text) as Part);
    }
    await call('POST', `${key}?uploadId=${uploadId}`, { 'content-type': 'application/json' }, Buffer.from(JSON.stringify({ parts })));
  };
}
