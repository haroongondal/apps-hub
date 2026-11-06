import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseCsv } from '../csv.ts';
import type { Login } from '../entry.ts';
import { ImportError, parseGoogleExport } from '../google-import.ts';
import { loadPublicSuffixList } from '../public-suffix.ts';

const android = '../../../../apps/strongroom/modules/strongroom-vault/android/src';
const read = (rel: string) => readFileSync(new URL(`${android}/${rel}`, import.meta.url), 'utf8');
loadPublicSuffixList(read('main/resources/public_suffix_list.dat'));

const header = 'name,url,username,password,note\r\n';
const flagPrefix = 'Imported twice with different passwords. Delete the wrong one.\n';
const hash = '01'.repeat(32);
const hashB64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));
const imp = (body: string, now = 42) => parseGoogleExport(header + body, now);
const messageOf = (csv: string): string => {
  try {
    parseGoogleExport(csv, 0);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected an ImportError');
};

test("a Strongroom export's card and note rows are skipped, and its app_domain column is read", () => {
  const csv =
    'name,url,username,password,note,type,holder,number,exp_month,exp_year,cvc,app_domain\n' +
    `Bank,android://${hashB64}@com.bank/,me,pw,,login,,,,,,bank.example\n` +
    'Visa,,,,,card,A. Holder,4111,3,2031,321,\n' +
    'Wi-Fi,,,,secret,note,,,,,,\n';
  const r = parseGoogleExport(csv, 1);
  assert.equal(r.logins.length, 1);
  assert.deepEqual(r.logins[0].apps, [{ pkg: 'com.bank', certSha256: hash, domain: 'bank.example' }]);
  assert.equal(r.merged, 0);
});

test('an android:// URL becomes an app link', () => {
  const r = imp(`Example app,android://${hashB64}@com.example/,me,pw,\r\n`);
  assert.deepEqual(r.logins[0].apps, [{ pkg: 'com.example', certSha256: hash, domain: null }]);
  assert.deepEqual(r.logins[0].sites, []);
});

test('standard and URL-safe base64 hashes both decode', () => {
  const bytes = new Uint8Array(32).fill(0xfb);
  const standard = btoa(String.fromCharCode(...bytes));
  const urlSafe = standard.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  assert.ok(standard.includes('/') && standard.includes('+'));
  assert.ok(urlSafe.includes('_') && urlSafe.includes('-'));
  for (const b64 of [standard, urlSafe]) {
    assert.deepEqual(imp(`x,android://${b64}@com.example/,me,pw,\r\n`).logins[0].apps, [{ pkg: 'com.example', certSha256: 'fb'.repeat(32), domain: null }], b64);
  }
});

test('a hash that is not 32 bytes of base64, or an odd package, gives no app link but still imports', () => {
  const short = btoa(String.fromCharCode(...new Uint8Array(31).fill(1)));
  const long = btoa(String.fromCharCode(...new Uint8Array(33).fill(1)));
  for (const url of ['android://not-base64!@com.example/', `android://${short}@com.example/`, `android://${long}@com.example/`,
    'android://@com.example/', `android://${hashB64}@/`, `android://${hashB64}@bad pkg/`, `android://${hashB64}@com.exa;mple/`, `android://${hashB64}`]) {
    const r = imp(`x,${url},me,pw,\r\n`);
    assert.equal(r.logins.length, 1, url);
    assert.deepEqual(r.logins[0].apps, [], url);
  }
});

test('an android URL splits on the first @', () => {
  assert.deepEqual(imp(`x,android://${hashB64}@com.example/login@home,me,pw,\r\n`).logins[0].apps, [{ pkg: 'com.example', certSha256: hash, domain: null }]);
});

test('a web URL becomes a site', () => {
  const l = imp('x,https://accounts.example.com/login,me,pw,\r\n').logins[0];
  assert.deepEqual(l.sites, [{ https: true, host: 'accounts.example.com' }]);
  assert.deepEqual(l.apps, []);
});

test('other URLs import with no site and no app, and the URL goes on a note line', () => {
  const r = imp('a,ftp://files.example.com/,me,pw1,\r\nb,example.com,me,pw2,\r\nc,,me,pw3,\r\n');
  assert.equal(r.logins.length, 3);
  assert.equal(r.merged, 0);
  assert.equal(r.flagged, 0);
  assert.ok(r.logins.every((l) => l.sites.length === 0 && l.apps.length === 0));
  assert.deepEqual(r.logins.map((l) => l.note), ['Imported from ftp://files.example.com/', 'Imported from example.com', '']);
});

test('unlinked logins on different URLs, or blank URLs with different names, are not merged or flagged', () => {
  const urls = imp('Router,192.168.1.1,admin,admin,\r\nNAS,192.168.1.2,admin,admin,\r\n');
  assert.deepEqual([urls.logins.length, urls.merged, urls.flagged], [2, 0, 0]);
  const mixed = imp('Bank A,ftp://a.example/,me,pw1,\r\nBank B,b.example,me,pw2,\r\n');
  assert.deepEqual([mixed.logins.length, mixed.flagged], [2, 0]);
  const blank = imp('A,,me,pw,\r\nB,,me,pw,\r\nC,,me,other,\r\n');
  assert.deepEqual([blank.logins.length, blank.merged, blank.flagged], [3, 0, 0]);
});

test('identical unlinked logins merge, and the same URL with different passwords is flagged', () => {
  const same = imp('Router,192.168.1.1,admin,admin,\r\nRouter,192.168.1.1,admin,admin,\r\n');
  assert.deepEqual([same.logins.length, same.merged], [1, 1]);
  const clash = imp('Router,192.168.1.1,admin,one,\r\nRouter,192.168.1.1,admin,two,\r\n');
  assert.deepEqual([clash.logins.length, clash.flagged], [2, 2]);
  assert.equal(clash.logins[0].note, `${flagPrefix}Imported from 192.168.1.1`);
});

test('an unlinked login keeps its URL on its own note line', () => {
  const r = imp('Router,192.168.1.1,admin,pw1,my note\r\nNas,,admin,pw2,\r\n');
  assert.equal(r.logins[0].note, 'my note\nImported from 192.168.1.1');
  assert.equal(r.logins[1].note, '');
});

test('merged duplicates keep every distinct note', () => {
  const r = imp('a,https://example.org/,me,pw,first\r\nb,https://example.org/,me,pw,second\r\nc,https://example.org/,me,pw,first\r\nd,https://example.org/,me,pw,\r\n');
  assert.deepEqual([r.logins.length, r.merged], [1, 3]);
  assert.equal(r.logins[0].note, 'first\nsecond');
  assert.equal(imp('R,10.0.0.1,me,pw,n1\r\nR,10.0.0.1,me,pw,n2\r\n').logins[0].note, 'n1\nn2\nImported from 10.0.0.1');
});

test('exact duplicates merge, whatever the path of the URL', () => {
  const r = imp('a,https://example.org/,me,pw,\r\nb,https://example.org/x,me,pw,note\r\nc,https://example.org,me,pw,\r\n');
  assert.deepEqual([r.logins.length, r.merged, r.flagged], [1, 2, 0]);
  assert.equal(r.logins[0].name, 'a');
});

test('the same place and user with different passwords is flagged for review', () => {
  const r = imp('a,https://example.org/,me,pw1,keep this\r\nb,https://example.org/,me,pw2,\r\nc,https://example.org/,you,pw3,\r\n');
  assert.deepEqual([r.logins.length, r.flagged, r.merged], [3, 2, 0]);
  assert.equal(r.logins[0].note, `${flagPrefix}keep this`);
  assert.equal(r.logins[1].note, flagPrefix);
  assert.equal(r.logins[2].note, '');
});

test('a flagged group counts every member and still merges copies', () => {
  const r = imp('a,https://example.org/,me,pw1,\r\nb,https://example.org/,me,pw2,\r\nc,https://example.org/,me,pw3,\r\nd,https://example.org/,me,pw2,\r\n');
  assert.deepEqual([r.logins.length, r.merged, r.flagged], [3, 1, 3]);
  assert.ok(r.logins.every((l) => l.note.startsWith(flagPrefix)));
});

test('the same user on different sites is not flagged', () => {
  const r = imp('a,https://one.example/,me,pw1,\r\nb,https://two.example/,me,pw2,\r\n');
  assert.deepEqual([r.logins.length, r.flagged], [2, 0]);
});

test('an empty username and a pathless URL import', () => {
  const l = imp('example.org,https://example.org,,pw,\r\n').logins[0];
  assert.equal(l.username, '');
  assert.deepEqual(l.sites, [{ https: true, host: 'example.org' }]);
});

test('a row with more cells than the header is refused without echoing its values', () => {
  const message = 'Row 2 of this file has more columns than its header, so a value may be split. Export again from Google Password Manager.';
  const m = messageOf(`${header}a,https://example.org/,me,pw,\r\n\r\nx,https://example.org/,me,hunter2,ss,note\r\n`);
  assert.equal(m, message);
  assert.ok(!m.includes('hunter2'));
  assert.equal(messageOf(`${header}x,https://example.org/,me,pa,ss,note\r\n`), message.replace('Row 2', 'Row 1'));
});

test('a file that is not a Google export says so', () => {
  const message = "This file isn't a Google Passwords export. Export again from Google Password Manager and pick that file.";
  for (const csv of ['title,address\r\nx,y\r\n', 'name,url,username\r\nx,y,z\r\n', '']) assert.equal(messageOf(csv), message, csv);
});

test('an unterminated quote is a damaged file and never echoes the content', () => {
  const m = messageOf(`${header}x,https://example.org/,me,"hunter2-secret,\r\n`);
  assert.equal(m, 'This file is damaged: a quoted field never ends. Export again from Google Password Manager.');
  assert.ok(!m.includes('hunter2'));
});

test('the header matches after trimming, in any case and column order', () => {
  const l = parseGoogleExport('﻿ Password ,USERNAME,Url, name\r\npw,me,https://example.org/,Example\r\n', 1).logins[0];
  const expected: Login = { type: 'login', name: 'Example', username: 'me', password: 'pw', sites: [{ https: true, host: 'example.org' }], apps: [], note: '', updatedAt: 1 };
  assert.deepEqual(l, expected);
});

test('the note column is optional', () => {
  assert.equal(parseGoogleExport('name,url,username,password\r\nx,https://example.org/,me,pw\r\n', 1).logins[0].note, '');
});

test('blank lines are skipped and short rows are padded', () => {
  const csv = '\r\nname,url,username,password,note\r\n\r\nx,https://example.org/,me\r\n\r\ny,https://example.net/,you,pw,n\r\n\r\n';
  const r = parseGoogleExport(csv, 1);
  assert.equal(r.logins.length, 2);
  assert.equal(r.logins[0].password, '');
  assert.deepEqual([r.logins[1].password, r.logins[1].note], ['pw', 'n']);
});

test('a missing name falls back to the registrable domain, then the host, then the package', () => {
  const r = imp(
    ',https://accounts.example.com/login,me,pw1,\r\n' +
      ',https://localhost:8080/,me,pw2,\r\n' +
      `,android://${hashB64}@com.example.app/,me,pw3,\r\n` +
      ',,me,pw4,\r\n' +
      '  ,https://example.org,me,pw5,\r\n',
  );
  assert.deepEqual(r.logins.map((l) => l.name), ['example.com', 'localhost:8080', 'com.example.app', '', 'example.org']);
});

test('updatedAt is now, and names are kept verbatim', () => {
  const l = imp(' My Bank ,https://example.org/,me,pw,\r\n', 1_700_000_000_000).logins[0];
  assert.equal(l.name, ' My Bank ');
  assert.equal(l.updatedAt, 1_700_000_000_000);
  assert.equal(l.type, 'login');
});

test('the redacted real-export fixture parses with the expected counts', () => {
  const text = read('test/resources/google-export-redacted.csv');
  assert.ok(text.startsWith('﻿') && text.includes('\r\n'));
  const dataRows = parseCsv(text).length - 1;
  const r = parseGoogleExport(text, 5);
  assert.equal(dataRows, 9);
  assert.equal(r.merged, 1);
  assert.equal(r.flagged, 2);
  assert.equal(r.logins.length, dataRows - r.merged);
  assert.deepEqual(r.logins.map((l) => l.name), ['example.org', 'accounts.example.com', 'Team wiki', 'Example app', 'Broken hash', 'Mail', 'Forum', 'Forum']);
  assert.equal(r.logins[2].note, 'Shared with "ops", rotate monthly.\nSecond line of the note');
  assert.equal(r.logins[4].note, 'Imported from android://not-base64!@com.example.broken/');
  assert.ok(r.logins[6].note.startsWith(flagPrefix) && r.logins[7].note.startsWith(flagPrefix));
});
