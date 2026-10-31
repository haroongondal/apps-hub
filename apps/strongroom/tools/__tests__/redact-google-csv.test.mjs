import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const script = join(import.meta.dirname, '..', 'redact-google-csv.mjs');
const resources = join(import.meta.dirname, '..', '..', 'modules', 'strongroom-vault', 'android', 'src', 'test', 'resources');
const dir = mkdtempSync(join(tmpdir(), 'redact-google-csv-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const input = (name, text) => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

test('redacting the sample reproduces the committed fixture byte for byte', () => {
  const out = join(dir, 'sample-out.csv');
  const r = run(join(resources, 'google-export-sample.csv'), out);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readFileSync(out), readFileSync(join(resources, 'google-export-redacted.csv')));
});

test('finds columns by header, keeps quoting and line endings, pads nothing', () => {
  const out = join(dir, 'odd-out.csv');
  const r = run(input('odd.csv', 'Name, Password ,note,USERNAME,url\nx,"a,b",n,u1,y\nx,short\n\nz,,n2,,y\nw,a,n,u1,y\n'), out);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    readFileSync(out, 'utf8'),
    'Name, Password ,note,USERNAME,url\nx,"pw1",n,user1@example.com,y\nx,pw2\n\nz,,n2,,y\nw,pw3,n,user1@example.com,y\n',
  );
});

test('a file without username and password columns exits 1 and writes nothing', () => {
  const out = join(dir, 'bad-out.csv');
  const r = run(input('bad.csv', 'title,address\r\nx,y\r\n'), out);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /username and password columns/);
  assert.equal(existsSync(out), false);
});

test('a row with more cells than the header exits 1, names only the row and writes nothing', () => {
  const out = join(dir, 'wide-out.csv');
  const r = run(input('wide.csv', 'name,url,username,password,note\r\nok,https://a.example/,u,p,n\r\nx,https://b.example/,me,hunter2,ss,note\r\n'), out);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^Row 2 of this file has more columns than its header/);
  assert.doesNotMatch(r.stderr, /hunter2|b\.example/);
  assert.equal(existsSync(out), false);
});

test('wrong arguments print the usage line and exit 2', () => {
  for (const args of [[], ['only-one.csv'], ['a', 'b', 'c']]) {
    const r = run(...args);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^Usage: node redact-google-csv\.mjs <in\.csv> <out\.csv>/);
  }
});

test('an unwritable output path exits 1 with a message, not a stack trace', () => {
  const r = run(join(resources, 'google-export-sample.csv'), join(dir, 'missing-folder', 'out.csv'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^Can't write /);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});
