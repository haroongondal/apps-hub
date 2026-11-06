// The Android tests read this same vector file, so passing here means both sides agree byte for byte.
import { readFileSync } from 'node:fs';
import type { KdfParams } from '../crypto.ts';

const path = new URL(
  '../../../../apps/strongroom/modules/strongroom-vault/android/src/test/resources/vault-vectors.json',
  import.meta.url,
);

export const vectors = JSON.parse(readFileSync(path, 'utf8'));

export const hex = (s: string): Uint8Array => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// The vectors use 1 MiB and one pass so tests are fast; the production floor would refuse them.
export const LOW_FLOOR: KdfParams = { memoryKiB: 8, iterations: 1, parallelism: 1 };
export const LOW_KDF: KdfParams = { memoryKiB: 1024, iterations: 1, parallelism: 1 };
