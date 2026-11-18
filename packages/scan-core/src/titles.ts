const pad = (n: number) => String(n).padStart(2, '0');

/** "Scan 2026-10-31 14:05" or "Card 2026-10-31 14:05", in local time. */
export function defaultTitle(mode: 'document' | 'card', now: number): string {
  const d = new Date(now);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${mode === 'card' ? 'Card' : 'Scan'} ${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
