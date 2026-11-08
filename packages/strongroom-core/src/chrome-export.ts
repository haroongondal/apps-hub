import type { Login } from './entry.ts';

const quote = (c: string) => (/[",\r\n]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c);

/** RFC 4180: a cell is quoted when it holds a comma, quote, CR or LF; every row ends CRLF. */
export function formatCsv(rows: string[][]): string {
  return rows.map((r) => r.map(quote).join(',') + '\r\n').join('');
}

/** Chrome's password import reads exactly name,url,username,password,note; a login with no website has no row to give it. */
export function exportForChrome(logins: Login[]): { csv: string; rows: number; leftOut: number } {
  const rows = logins
    .flatMap((l) => l.sites.map((s) => [l.name, `${s.https ? 'https' : 'http'}://${s.host}`, l.username, l.password, l.note]))
    .sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()));
  return {
    csv: formatCsv([['name', 'url', 'username', 'password', 'note'], ...rows]),
    rows: rows.length,
    leftOut: logins.filter((l) => l.sites.length === 0).length,
  };
}
