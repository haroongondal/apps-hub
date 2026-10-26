import { StoreManifestSchema, type StoreManifest } from '@apps-hub/store-manifest';
import { z } from 'zod';

z.config({ jitless: true });

export interface Credentials {
  apiUrl: string;
  token: string;
}

const base = (c: Credentials) => c.apiUrl.replace(/\/$/, '');
const headers = (c: Credentials) => ({ authorization: `Bearer ${c.token}` });

export async function fetchManifest(c: Credentials): Promise<StoreManifest> {
  const res = await fetch(`${base(c)}/manifest.json`, { headers: headers(c) });
  if (res.status === 401) throw new Error('Token rejected. Sign out and enter the current token.');
  if (!res.ok) throw new Error(`Manifest request failed (HTTP ${res.status})`);
  return StoreManifestSchema.parse(await res.json());
}

export async function signUrl(c: Credentials, path: string): Promise<string> {
  const res = await fetch(`${base(c)}/sign`, {
    method: 'POST',
    headers: { ...headers(c), 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error(`Could not sign download URL (HTTP ${res.status})`);
  return ((await res.json()) as { url: string }).url;
}
