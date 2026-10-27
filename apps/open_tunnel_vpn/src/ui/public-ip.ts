/**
 * Public IP badge source (phase-4 plan G3): a plain-text echo against
 * neutral infrastructure, fetched strictly on user request, cached in
 * memory only, and never read by the tunnel state machine. The cache is
 * dropped whenever the tunnel state changes so a connect/disconnect always
 * re-measures on the next tap instead of showing a stale address.
 */
const PUBLIC_IP_ECHO_URL = 'https://checkip.amazonaws.com';
const PUBLIC_IP_TIMEOUT_MS = 8000;

let cachedAddress: string | null = null;

/** Drops the in-memory cache (called by the UI on tunnel-state changes). */
export function forgetPublicIp(): void {
  cachedAddress = null;
}

/** Minimal sanity check: an IP-looking token, nothing else. */
function isAddressText(text: string): boolean {
  return /^[0-9a-fA-F.:]{3,45}$/.test(text);
}

export async function fetchPublicIp(signal: AbortSignal): Promise<string> {
  if (cachedAddress !== null) return cachedAddress;
  const response = await fetch(PUBLIC_IP_ECHO_URL, { signal });
  if (!response.ok) {
    throw new Error(`the address check failed (HTTP ${response.status})`);
  }
  const text = (await response.text()).trim();
  if (!isAddressText(text)) {
    throw new Error('the address check returned an unexpected response');
  }
  cachedAddress = text;
  return text;
}
