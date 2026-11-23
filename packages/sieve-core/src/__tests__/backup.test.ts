import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKUP_MAX_CHARS, BACKUP_TOO_BIG, backupFileName, makeBackup, readBackup } from '../backup.ts';
import { validateSettings } from '../settings.ts';
import { validateYouTube } from '../youtube-settings.ts';

const settings = validateSettings({
  enabled: false,
  blocking: { paused: true, lists: { ai: true, ads: false }, allowlist: [{ kind: 'site', host: 'example.com' }], myFilters: '||tracker.test^\n' },
});
const youtube = validateYouTube({ speed: { setDefault: true, default: 1.5 }, tidy: { hideShorts: true }, theme: { css: 'a{color:red}' } });
const now = new Date('2026-11-08T10:00:00Z');

test('a backup reads back as the same settings and YouTube options', () => {
  const back = readBackup(JSON.stringify(makeBackup(settings, youtube, now)));
  assert.deepEqual(back, { ok: true, settings, youtube });
  assert.equal(makeBackup(settings, youtube, now).exportedAt, '2026-11-08T10:00:00.000Z');
});

test('each refusal gives its own plain reason, checked in order', () => {
  const reason = (text: string) => {
    const r = readBackup(text);
    return r.ok ? 'ok' : r.reason;
  };
  assert.equal(reason(' '.repeat(BACKUP_MAX_CHARS + 1)), 'This file is too big to be a Sieve backup.');
  assert.equal(reason(' '.repeat(BACKUP_MAX_CHARS + 1)), BACKUP_TOO_BIG);
  assert.equal(reason('hello'), "This file isn't a Sieve backup: it isn't valid JSON.");
  for (const text of ['[]', 'null', '3', '{}', '{"app":"other","version":1}']) assert.equal(reason(text), "This file isn't a Sieve backup.", text);
  assert.equal(reason('{"app":"sieve","version":2}'), 'This backup comes from a newer Sieve. Update Sieve, then import it again.');
  for (const v of ['"1"', '0', 'null', '-1', 'true']) assert.equal(reason(`{"app":"sieve","version":${v}}`), "This file isn't a Sieve backup.", v);
  assert.equal(reason('{"app":"sieve"}'), "This file isn't a Sieve backup.");
});

test('the YouTube tools switch round-trips, and an older file without it reads as on', () => {
  const off = validateYouTube({ on: false });
  const back = readBackup(JSON.stringify(makeBackup(settings, off, now)));
  assert.equal(back.ok && back.youtube.on, false);
  const old = JSON.parse(JSON.stringify(makeBackup(settings, youtube, now)));
  delete old.youtube.on;
  const read = readBackup(JSON.stringify(old));
  assert.equal(read.ok && read.youtube.on, true);
});

test('a missing youtube part gives the defaults, and an invalid allowlist entry is dropped', () => {
  const backup = { app: 'sieve', version: 1, settings: { blocking: { allowlist: [{ kind: 'site', host: 'not a host!' }, { kind: 'site', host: 'ok.example' }] } } };
  const r = readBackup(JSON.stringify(backup));
  assert.ok(r.ok);
  assert.deepEqual(r.youtube, validateYouTube(undefined));
  assert.deepEqual(r.settings.blocking.allowlist, [{ kind: 'site', host: 'ok.example' }]);
});

test('the file name uses the local date', () => {
  assert.equal(backupFileName(new Date(2026, 10, 8)), 'sieve-settings-2026-11-08.json');
  assert.equal(backupFileName(new Date(2026, 0, 3, 23, 59)), 'sieve-settings-2026-01-03.json');
});
