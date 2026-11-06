import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { test } from 'node:test';

// PRD FR-13 and AC-16: a release build shows no engineering words and no Mac wording on the phone.
const APP = new URL('../../', import.meta.url).pathname;
const ENGINE = join(APP, '../../packages/design-editor-engine');

const BANNED: [string, RegExp][] = [
  ['codec word', /\b(codec|bitrate|cbr|vbr|keyframe|encoder|remux|transcode|lufs|mediastore|ffmpeg|media3)\b/i],
  ['codec name', /\b(H\.?264|HEVC|AAC)\b/],
  ['build word', /\b(spike|phase|media lab)\b|\bS[1-8]:/i],
  ['mouse word', /\b(right-?click|double-?click|click)\b/i],
  ['Mac wording', /this mac|⌘|⇧|\bmagic resize\b|drop images|\(px\)/i],
  ['storage path', /(Documents|Movies|Pictures|Music)\/Design Editor|\/data\/|file:\/\//],
  ['attempt counter', /\btry \d|attempt \d|\bjob id\b/i],
];

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/\s.*$/gm, '');

// Every quoted string and every piece of JSX text, minus module paths.
function literals(src: string): string[] {
  const code = stripComments(src).split('\n').filter(l => !/^\s*(import|export)\b.*\bfrom\b/.test(l) && !/require\(/.test(l)).join('\n');
  const out: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) out.push(m[1] ?? m[2] ?? m[3]);
  for (const m of code.matchAll(/>([^<>{}=;[\]]+)</g)) out.push(m[1].trim());
  // Code identifiers (keys, event names, paths) are not text a person reads: no space and all lower case.
  return out.map(s => s.replace(/\$\{[^}]*\}/g, '')).filter(s => /[A-Za-z]{3}/.test(s) && !/^[a-z0-9_./:-]+$/.test(s));
}

function htmlText(html: string): string[] {
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script)[\s\S]*?<\/\1>/g, '');
  const out = [...body.matchAll(/>([^<]+)</g)].map(m => m[1].trim());
  for (const m of body.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]*)"/g)) out.push(m[1]);
  return out.filter(s => /[A-Za-z]{3}/.test(s));
}

function files(dir: string, ext: RegExp, skip: RegExp): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (skip.test(path)) return [];
    return statSync(path).isDirectory() ? files(path, ext, skip) : ext.test(name) ? [path] : [];
  });
}

function offences(where: string, strings: string[]): string[] {
  return strings.flatMap(s => BANNED.filter(([, re]) => re.test(s)).map(([kind]) => `${where}: ${kind}: "${s.replace(/\s+/g, ' ').slice(0, 90)}"`));
}

test('the screens and their helpers use plain words (the debug lab is exempt)', () => {
  const skip = /node_modules|__tests__|[\\/]lab([\\/]|\.tsx$)|[\\/]android[\\/]|assets|modules/;
  const found = files(join(APP, 'app'), /\.tsx?$/, skip).concat(files(join(APP, 'src'), /\.tsx?$/, skip))
    .flatMap(f => offences(relative(APP, f), literals(readFileSync(f, 'utf8'))));
  assert.deepEqual(found, []);
});

test('the editor page says nothing a phone cannot do or a person cannot read', () => {
  const found = [
    ...offences('mobile.html', htmlText(readFileSync(join(ENGINE, 'mobile.html'), 'utf8'))),
    ...['app.js', 'shell-mobile.js', 'touch.js'].flatMap(f => offences(f, literals(readFileSync(join(ENGINE, f), 'utf8')))),
  ];
  assert.deepEqual(found, []);
});

test('the phone column of the engine copy table is plain too', () => {
  const table = createRequire(import.meta.url)(join(ENGINE, 'copy.js')) as { phone: Record<string, unknown> };
  const found = Object.entries(table.phone).flatMap(([key, value]) => offences(`copy.js phone.${key}`, [String(value)]));
  assert.deepEqual(found, []);
});

test('the debug lab stays out of release builds', () => {
  const route = readFileSync(join(APP, 'app/lab.tsx'), 'utf8');
  assert.match(route, /__DEV__/);
  assert.doesNotMatch(route, /^import .*src\/lab/m, 'the lab must be required inside the __DEV__ branch only');
  const home = readFileSync(join(APP, 'app/(tabs)/index.tsx'), 'utf8');
  assert.doesNotMatch(home, /Media lab/);
});
