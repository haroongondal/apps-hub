// The vault-api wire protocol (DESIGN.md §10): binary fields are standard base64, errors are { error: string }.
import type { KdfParams } from '../crypto.ts';

export const LIMITS = {
  tokenBytes: 32,
  maxCiphertextChars: 90_000,
  maxUpserts: 100,
  maxPullLimit: 500,
  maxHeaderChars: 4096,
  idPattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
} as const;

export type Prelogin = { version: number; kdf: KdfParams; salt: string; accountKey: boolean };

export type AccountCreate = { header: string; loginHash: string; recoveryHash: string; readHash: string };
// An update names the header revision it replaces (the Worker answers 400 without it), so it never overwrites blindly; devices don't hold the recovery key, so without recoveryHash the Worker keeps the stored one.
export type AccountUpdate = Omit<AccountCreate, 'recoveryHash'> & {
  recoveryHash?: string;
  ifRev: number;
  escrow?: { email: string; blob: string; code: string };
};
export type AccountPutResponse = { headerRev: number };

export type WireRecord = { id: string; rev: number; ciphertext: string; updatedAt: number };
export type PullResponse = { header: string; headerRev: number; records: WireRecord[]; latestRev: number; more: boolean };

// baseRev 0 means "new id"; a push is all or nothing.
export type Upsert = { id: string; baseRev: number; ciphertext: string };
export type PushRequest = { upserts: Upsert[] };
export type PushResponse = { revs: { id: string; rev: number }[]; latestRev: number };
export type PushConflict = { conflicts: { id: string; rev: number }[] };

export type ErrorBody = { error: string };
