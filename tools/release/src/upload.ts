// One request body is capped near 100 MB on Cloudflare, so anything bigger than a part goes up in parts
// (the Worker's multipart routes under /admin/). R2 wants equal-sized parts except the last.
export const PART_BYTES = 32 * 1024 * 1024;

type Part = { partNumber: number; etag: string };

export function makeUploader(api: string, token: string, send: typeof fetch = fetch, partBytes = PART_BYTES) {
  async function call(what: string, path: string, init: RequestInit): Promise<Response> {
    const res = await send(`${api}/admin/${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } });
    if (!res.ok) throw new Error(`${what} ${path}: ${res.status} ${await res.text()}`);
    return res;
  }

  return async function upload(key: string, body: Buffer | string, contentType: string): Promise<void> {
    const bytes = typeof body === 'string' ? Buffer.from(body) : body;
    if (bytes.length <= partBytes) {
      await call('PUT', key, { method: 'PUT', headers: { 'content-type': contentType }, body: new Uint8Array(bytes) });
      return;
    }
    const started = await call('POST', `${key}?uploads`, { method: 'POST', headers: { 'content-type': contentType } });
    const { uploadId } = (await started.json()) as { uploadId: string };
    const parts: Part[] = [];
    for (let at = 0, n = 1; at < bytes.length; at += partBytes, n++) {
      const res = await call('PUT', `${key}?uploadId=${uploadId}&part=${n}`, {
        method: 'PUT',
        body: new Uint8Array(bytes.subarray(at, at + partBytes)),
      });
      parts.push((await res.json()) as Part);
    }
    await call('POST', `${key}?uploadId=${uploadId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parts }),
    });
  };
}
