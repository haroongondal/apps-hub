const CAUSED_BY = '→ Caused by: ';
const UNEXPECTED = 'Something went wrong inside Strongroom. Close the app, open it again and retry.';

const codeOf = (e: unknown) => (e as { code?: unknown } | null)?.code;

export const isLocked = (e: unknown) => codeOf(e) === 'LOCKED';

// The bridge's own codes carry an owner-ready message; Expo's ERR_* codes (an unexpected crash) don't.
export function messageOf(e: unknown): string {
  const code = codeOf(e);
  const message = (e as { message?: unknown } | null)?.message;
  if (typeof code !== 'string' || code.startsWith('ERR_') || typeof message !== 'string') return UNEXPECTED;
  const at = message.lastIndexOf(CAUSED_BY);
  return at < 0 ? message : message.slice(at + CAUSED_BY.length);
}

let pending = 0;

export const deriving = () => pending > 0;

// Key derivation holds the vault lock and the bridge's sync calls wait on it, so the status re-check skips while one is pending.
export async function whileDeriving<T>(call: () => Promise<T>): Promise<T> {
  pending++;
  try {
    return await call();
  } finally {
    pending--;
  }
}
