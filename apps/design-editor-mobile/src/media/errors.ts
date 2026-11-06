// Expo wraps a native error like "Call to function 'DesignMedia.open' has been rejected.\n→ Caused by: java.lang.IllegalStateException: No app on this phone can open that file."
// Show only the sentence a person can read; anything technical becomes the fallback (PRD FR-13).
export function plainError(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const cause = raw.split('Caused by:').pop() ?? '';
  const text = cause.replace(/^\s*[\w.$]+(?:Exception|Error):\s*/, '').replace(/\s+/g, ' ').trim();
  const technical = /Exception|Error|status\s*=|0x[0-9a-f]{3,}|setDataSource|Call to function|\b(java|android|androidx|expo|kotlin)\./i;
  return text && text.length <= 200 && !technical.test(text) ? text : fallback;
}
