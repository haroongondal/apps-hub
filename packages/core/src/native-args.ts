/**
 * JS-side argument checks for udpRequest and tcpFetch, like udpBroadcastArgsError: Expo's iOS bridge traps on a
 * NaN, Infinity or huge JS number before the native range check runs. Error texts match the native INVALID_PARAMS ones.
 */
const bad = (n: number, min: number, max: number): boolean => !Number.isInteger(n) || n < min || n > max;

export function udpRequestArgsError(port: number, payload: readonly number[], timeoutMs: number): string | null {
  if (bad(port, 1, 65535)) return 'port must be in 1..65535';
  if (!payload.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) return 'payload bytes must be in 0..255';
  if (bad(timeoutMs, 1, 10_000)) return 'timeoutMs must be in 1..10000';
  return null;
}

export function tcpFetchArgsError(port: number, timeoutMs: number, maxBytes: number): string | null {
  if (bad(port, 1, 65535)) return 'port must be in 1..65535';
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return 'maxBytes must be positive';
  if (bad(timeoutMs, 1, 10_000)) return 'timeoutMs must be in 1..10000';
  return null;
}
