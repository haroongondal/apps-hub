import { MANIFEST_PATH } from '@apps-hub/store-manifest';

interface StoredObject {
  body: ReadableStream;
  size: number;
  httpMetadata?: { contentType?: string };
}

export interface Bucket {
  get(key: string): Promise<StoredObject | null>;
  put(key: string, value: ReadableStream, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

export interface Env {
  BUCKET: Bucket;
  STORE_TOKEN: string;
  RELEASE_TOKEN: string;
  SIGNING_KEY: string;
}

export const SIGNED_URL_TTL_S = 600;
const enc = new TextEncoder();

async function hmac(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Compares MACs of both inputs so timing never depends on the secret's bytes.
async function safeEqual(a: string, b: string, key: string): Promise<boolean> {
  return (await hmac(key, a)) === (await hmac(key, b));
}

async function authorized(req: Request, env: Env, ...tokens: string[]): Promise<boolean> {
  const presented = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  for (const token of tokens) {
    if (token && token.length >= 32 && (await safeEqual(presented, token, env.SIGNING_KEY))) return true;
  }
  return false;
}

const isKey = (key: string) => /^[a-z0-9][a-z0-9/._-]*$/i.test(key) && !key.includes('..');
const status = (code: number, message: string) => new Response(message, { status: code });

async function serve(env: Env, key: string): Promise<Response> {
  const obj = await env.BUCKET.get(key);
  if (!obj) return status(404, 'not found');
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'content-length': String(obj.size),
      'cache-control': 'private, no-store',
    },
  });
}

export async function handle(req: Request, env: Env, now = Date.now()): Promise<Response> {
  if (!env.SIGNING_KEY) return status(500, 'not configured');
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === 'GET' && path === `/${MANIFEST_PATH}`) {
    if (!(await authorized(req, env, env.STORE_TOKEN, env.RELEASE_TOKEN))) return status(401, 'unauthorized');
    return serve(env, MANIFEST_PATH);
  }

  if (req.method === 'POST' && path === '/sign') {
    if (!(await authorized(req, env, env.STORE_TOKEN, env.RELEASE_TOKEN))) return status(401, 'unauthorized');
    const body = (await req.json().catch(() => ({}))) as { path?: unknown };
    if (typeof body.path !== 'string' || !isKey(body.path) || !body.path.startsWith('apps/')) return status(400, 'bad path');
    const exp = Math.floor(now / 1000) + SIGNED_URL_TTL_S;
    const sig = await hmac(env.SIGNING_KEY, `${body.path}\n${exp}`);
    return Response.json({ url: `${url.origin}/f/${body.path}?exp=${exp}&sig=${sig}`, expiresAt: exp });
  }

  if (req.method === 'GET' && path.startsWith('/f/')) {
    const key = path.slice(3);
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig') ?? '';
    if (!isKey(key) || !(exp * 1000 > now)) return status(403, 'expired or invalid');
    if (!(await safeEqual(sig, await hmac(env.SIGNING_KEY, `${key}\n${exp}`), env.SIGNING_KEY))) return status(403, 'expired or invalid');
    return serve(env, key);
  }

  if (req.method === 'PUT' && path.startsWith('/admin/')) {
    if (!(await authorized(req, env, env.RELEASE_TOKEN))) return status(401, 'unauthorized');
    const key = path.slice('/admin/'.length);
    if (!isKey(key) || !req.body) return status(400, 'bad request');
    await env.BUCKET.put(key, req.body, {
      httpMetadata: { contentType: req.headers.get('content-type') ?? 'application/octet-stream' },
    });
    return new Response(null, { status: 204 });
  }

  return status(404, 'not found');
}

export default { fetch: (req: Request, env: Env) => handle(req, env) };
