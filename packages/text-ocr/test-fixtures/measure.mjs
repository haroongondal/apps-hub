// Reads every picture in truth.json with Tesseract (tesseract.js, WASM, same tessdata_fast files the app bundles)
// and prints the character error rate (CER) and the share of words found, raw and after the Library's search folding.
// Needs `npm i tesseract.js` on the module path. Usage: node measure.mjs <tessdataDir> [lang,lang+lang,...]
// It is a stand-in for the phone: tesseract.js ships a different Tesseract build than Tesseract4Android 4.9.0.
import { createWorker } from 'tesseract.js';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeForSearch } from '../../library-core/src/normalize.ts';

const here = path.dirname(new URL(import.meta.url).pathname);
const langPath = path.resolve(process.argv[2]);
const langs = (process.argv[3] ?? 'ara,urd,ara+eng,urd+eng,eng').split(',');
const truth = JSON.parse(fs.readFileSync(path.join(here, 'truth.json'), 'utf8'));
const flat = (s) => s.replace(/\s+/g, ' ').trim();
const lev = (a, b) => {
  a = [...a]; b = [...b];
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

const rows = [];
for (const lang of langs) {
  const w = await createWorker(lang.split('+'), 1, { langPath, gzip: false, cachePath: '/tmp/ocr-measure-cache' });
  await w.setParameters({ tessedit_pageseg_mode: '3' }); // PSM_AUTO, as Recognizer.kt
  for (const [name, t] of Object.entries(truth)) {
    const r = await w.recognize(path.join(here, `${name}.png`), {}, { blocks: true });
    const kept = []; // text lines at confidence 40 or more, as Recognizer.kt keeps them
    let seen = 0;
    for (const b of r.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) if (l.text.trim()) { seen++; if (l.confidence >= 40) kept.push(l.text.trim()); }
    const got = flat(kept.join(' ')), want = flat(t.lines.join(' '));
    const ng = flat(normalizeForSearch(got)), nw = flat(normalizeForSearch(want));
    const found = new Set(ng.split(' '));
    rows.push({
      lang, name, linesKept: kept.length, linesSeen: seen, linesInPicture: t.lines.length,
      cer: +(lev(got, want) / [...want].length).toFixed(3),
      cerFolded: +(lev(ng, nw) / [...nw].length).toFixed(3),
      wordsFound: +(nw.split(' ').filter((x) => found.has(x)).length / nw.split(' ').length).toFixed(3),
      got,
    });
  }
  await w.terminate();
}
fs.writeFileSync(path.join(here, 'results.json'), JSON.stringify(rows, null, 1));
for (const r of rows) console.log(r.lang.padEnd(8), r.name.padEnd(18), 'CER', r.cer, 'folded', r.cerFolded, 'words', r.wordsFound);
