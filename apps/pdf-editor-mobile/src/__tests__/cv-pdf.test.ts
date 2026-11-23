import test from 'node:test';
import assert from 'node:assert/strict';

import type { CvBody } from '../cv/model.ts';
import { renderCvPdf, toWinAnsi, wrap } from '../cv/pdf.ts';
import { TEMPLATE_LIST } from '../cv/templates.ts';

const cv: CvBody = {
  name: 'Ada (Lovelace)',
  title: 'Analyst',
  contact: ['ada@example.com', 'London'],
  sections: [
    { heading: 'Summary', entries: [{ title: '', subtitle: '', dates: '', lines: ['Writes engines for notes.'], plain: true }] },
    {
      heading: 'Experience',
      entries: [{ title: 'Engineer', subtitle: 'Analytical Engines', dates: '1842 - 1843', lines: ['Wrote the first algorithm.'], plain: false }],
    },
  ],
};

function checkXref(pdf: string): number {
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)?.[1]);
  const table = pdf.slice(start).split('\n');
  assert.equal(table[0], 'xref');
  const size = Number(table[1].split(' ')[1]);
  for (let i = 1; i < size; i++) {
    const offset = Number(table[2 + i].slice(0, 10));
    assert.ok(pdf.startsWith(`${i} 0 obj\n`, offset), `object ${i} at ${offset}`);
  }
  return size - 1;
}

test('every template writes a PDF whose xref offsets point at the objects', () => {
  for (const t of TEMPLATE_LIST) {
    const pdf = renderCvPdf(cv, t);
    assert.ok(pdf.startsWith('%PDF-1.4\n'), t.id);
    assert.equal(checkXref(pdf), 11, t.id);
    assert.match(pdf, /\/Count 1 /, t.id);
  }
});

test('text is escaped and the font is a standard WinAnsi font', () => {
  const pdf = renderCvPdf(cv, TEMPLATE_LIST[0]);
  assert.match(pdf, /\(Ada \\\(Lovelace\\\)\)/);
  assert.match(pdf, /\/BaseFont \/Times-Roman \/Encoding \/WinAnsiEncoding/);
});

test('a long CV continues on a new page with its own content stream', () => {
  const long: CvBody = {
    ...cv,
    sections: [
      {
        heading: 'Experience',
        entries: Array.from({ length: 40 }, (_, i) => ({ title: `Role ${i}`, subtitle: 'Org', dates: '2020', lines: ['Did a thing that took a while.'], plain: false })),
      },
    ],
  };
  const pdf = renderCvPdf(long, TEMPLATE_LIST[1]);
  assert.match(pdf, /\/Count 3 /);
  assert.equal(checkXref(pdf), 15);
});

test('wrap breaks at words and cuts a word that is wider than the line', () => {
  const width = (s: string) => s.length * 10;
  assert.deepEqual(wrap('one two three', 70, width), ['one two', 'three']);
  assert.deepEqual(wrap('abcdefghijkl', 50, width), ['abcde', 'fghij', 'kl']);
  assert.deepEqual(wrap('', 50, width), ['']);
});

test('characters outside WinAnsi become a question mark; typographic marks map to their code', () => {
  assert.equal(toWinAnsi('Café • “ok” — 2026'), 'Café \u0095 \u0093ok\u0094 \u0097 2026');
  assert.equal(toWinAnsi('مرحبا'), '?????');
});
