/** RFC 4180 records. Drops a leading BOM, accepts CRLF, LF and lone CR; throws only for a quoted field that never ends. */
export function parseCsv(text: string): string[][] {
  const s = text.startsWith('﻿') ? text.slice(1) : text;
  const rows: string[][] = [];
  let cells: string[] = [];
  let value = '';
  let start = 0; // a quote opens a quoted cell only at the cell's first character; anywhere else it is literal
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c !== '"') value += c;
      else if (s[i + 1] === '"') {
        value += '"';
        i++;
      } else inQuotes = false;
    } else if (c === '"' && i === start) {
      inQuotes = true;
    } else if (c === ',') {
      cells.push(value);
      value = '';
      start = i + 1;
    } else if (c === '\r' || c === '\n') {
      cells.push(value);
      value = '';
      rows.push(cells);
      cells = [];
      if (c === '\r' && s[i + 1] === '\n') i++;
      start = i + 1;
    } else value += c;
  }
  if (inQuotes) throw new Error('a quoted field never ends');
  if (cells.length > 0 || start < s.length) {
    cells.push(value);
    rows.push(cells);
  }
  return rows;
}
