import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fail = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

const [, , inPath, outPath, ...extra] = process.argv;
if (!inPath || !outPath || extra.length) fail('Usage: node redact-google-csv.mjs <in.csv> <out.csv>', 2);
if (resolve(inPath) === resolve(outPath)) fail('The output must be a different file, so your original export is never overwritten.', 2);

let text;
try {
  text = readFileSync(inPath, 'utf8');
} catch (e) {
  fail(`Can't read ${inPath} (${e.code ?? 'unknown error'}). Check the path and try again.`);
}

// RFC 4180 scan that keeps each cell's exact source text, so the output differs only in the redacted cells.
function scan(s) {
  const rows = [];
  let cells = [];
  let value = '';
  let quoted = false;
  let inQuotes = false;
  let start = 0;
  const endCell = (end) => {
    cells.push({ raw: s.slice(start, end), value, quoted });
    value = '';
    quoted = false;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c !== '"') value += c;
      else if (s[i + 1] === '"') { value += '"'; i++; }
      else inQuotes = false;
    } else if (c === '"' && i === start) {
      inQuotes = quoted = true;
    } else if (c === ',') {
      endCell(i);
      start = i + 1;
    } else if (c === '\r' || c === '\n') {
      endCell(i);
      const eol = c === '\r' && s[i + 1] === '\n' ? '\r\n' : c;
      i += eol.length - 1;
      rows.push({ cells, eol });
      cells = [];
      start = i + 1;
    } else {
      value += c;
    }
  }
  if (inQuotes) fail('This file is damaged: a quoted field never ends. Export again from Google Password Manager.');
  if (cells.length || start < s.length) {
    endCell(s.length);
    rows.push({ cells, eol: '' });
  }
  return rows;
}

const bom = text.startsWith('﻿') ? '﻿' : '';
const rows = scan(text.slice(bom.length));
const headerAt = rows.findIndex((row) => row.cells.some((cell) => cell.value !== ''));
const names = headerAt < 0 ? [] : rows[headerAt].cells.map((cell) => cell.value.trim().toLowerCase());
// N numbers each distinct value from 1 in file order: a repeated value keeps its number, so the importer still sees duplicates.
const columns = [
  { at: names.indexOf('username'), label: (n) => `user${n}@example.com`, numbers: new Map() },
  { at: names.indexOf('password'), label: (n) => `pw${n}`, numbers: new Map() },
];
if (columns.some((column) => column.at < 0)) {
  fail("This file isn't a Google Passwords export: it needs username and password columns. Export again from Google Password Manager and pick that file.");
}

for (const row of rows.slice(headerAt + 1)) {
  for (const { at, label, numbers } of columns) {
    const cell = row.cells[at];
    if (!cell || cell.value === '') continue;
    if (!numbers.has(cell.value)) numbers.set(cell.value, numbers.size + 1);
    const redacted = label(numbers.get(cell.value));
    cell.raw = cell.quoted ? `"${redacted}"` : redacted;
  }
}

writeFileSync(outPath, bom + rows.map((row) => row.cells.map((cell) => cell.raw).join(',') + row.eol).join(''));
console.log(`Wrote ${outPath}. It is safe to share. Delete ${inPath} now: it holds your real passwords.`);
