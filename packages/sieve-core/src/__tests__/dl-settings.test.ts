import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORY_IDS, DEFAULT_CATEGORIES, DEFAULT_DOWNLOADS, DEFAULT_TAKEOVER_EXTENSIONS, DEFAULT_TAKEOVER_MIME_TYPES,
  validateDownloadSettings as validate,
} from '../dl-settings.ts';
import type { DownloadSettings } from '../dl-settings.ts';

const EXTENSIONS = [
  'mp4', 'm4v', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mpg', 'mpeg', 'm2ts', '3gp',
  'mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'wma', 'aiff',
  'dmg', 'pkg', 'exe', 'msi', 'apk', 'ipa', 'deb', 'rpm', 'appimage', 'iso', 'img',
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'cab',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'epub', 'mobi',
];
const MIMES = [
  'application/octet-stream', 'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed',
  'application/vnd.rar', 'application/x-7z-compressed', 'application/gzip', 'application/x-gzip', 'application/x-tar',
  'application/x-bzip2', 'application/x-xz', 'application/zstd', 'application/x-apple-diskimage',
  'application/x-iso9660-image', 'application/x-msdownload', 'application/vnd.microsoft.portable-executable',
  'application/x-msi', 'application/vnd.android.package-archive', 'application/vnd.debian.binary-package',
  'application/x-rpm', 'application/x-newton-compatible-pkg', 'video/*', 'audio/*', 'application/pdf',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.*', 'application/vnd.oasis.opendocument.*', 'application/rtf',
  'application/epub+zip',
];
const LITERAL: DownloadSettings = {
  version: 1,
  on: true,
  takeOver: { on: true, minMb: 5, extensions: EXTENSIONS, mimeTypes: MIMES },
  parts: 1,
  speedLimit: { on: false, kbPerSecond: 1000 },
  categories: [
    { id: 'video', folder: 'Video', extensions: EXTENSIONS.slice(0, 12) },
    { id: 'music', folder: 'Music', extensions: EXTENSIONS.slice(12, 22) },
    { id: 'programs', folder: 'Programs', extensions: EXTENSIONS.slice(22, 33) },
    { id: 'archives', folder: 'Archives', extensions: EXTENSIONS.slice(33, 43) },
    { id: 'documents', folder: 'Documents', extensions: EXTENSIONS.slice(43) },
    { id: 'other', folder: 'Other', extensions: [] },
  ],
  queues: [{ id: 'main', name: 'Main queue', maxParallel: 3, schedule: { on: false, days: [0, 1, 2, 3, 4, 5, 6], start: '01:00', stop: '07:00' } }],
};

const v = (patch: Record<string, unknown>) => validate({ ...DEFAULT_DOWNLOADS, ...patch });
const vq = (q: unknown) => validate({ ...DEFAULT_DOWNLOADS, queues: q }).queues;
const vc = (c: unknown) => validate({ ...DEFAULT_DOWNLOADS, categories: c }).categories;

test('undefined, a string and a wrong version give DEFAULT_DOWNLOADS', () => {
  assert.deepEqual(validate(undefined), DEFAULT_DOWNLOADS);
  assert.deepEqual(validate('x'), DEFAULT_DOWNLOADS);
  assert.deepEqual(validate(null), DEFAULT_DOWNLOADS);
  assert.deepEqual(validate([]), DEFAULT_DOWNLOADS);
  assert.deepEqual(validate({ version: 2 }), DEFAULT_DOWNLOADS);
  assert.deepEqual(validate({}), DEFAULT_DOWNLOADS);
  assert.deepEqual(validate({ version: 2, parts: 5, on: false }), DEFAULT_DOWNLOADS);
  assert.deepEqual(validate({ version: '1', parts: 5, on: false }), DEFAULT_DOWNLOADS);
  assert.deepEqual(validate({ version: undefined, parts: 5 }), DEFAULT_DOWNLOADS);
  assert.equal(validate({ parts: 4 }).parts, 4, 'no version key: validated field by field');
  assert.equal(validate({ parts: 4 }).on, true);
  assert.notEqual(validate(undefined), DEFAULT_DOWNLOADS, 'a copy, so a caller cannot change the defaults');
  assert.notEqual(validate(undefined).queues, DEFAULT_DOWNLOADS.queues);
});

test('DEFAULT_CATEGORIES do not share arrays with each other or with DEFAULT_DOWNLOADS', () => {
  const all = [...DEFAULT_CATEGORIES.map((c) => c.extensions), ...DEFAULT_DOWNLOADS.categories.map((c) => c.extensions)];
  assert.equal(new Set(all).size, all.length);
});

test('DEFAULT_DOWNLOADS equals the spelled-out literal', () => {
  assert.deepEqual(DEFAULT_DOWNLOADS, LITERAL);
});

test('the default lists have 56 extensions, no duplicates, 31 MIME types, and other has no extensions', () => {
  assert.equal(DEFAULT_TAKEOVER_EXTENSIONS.length, 56);
  assert.equal(new Set(DEFAULT_TAKEOVER_EXTENSIONS).size, 56);
  assert.equal(DEFAULT_TAKEOVER_MIME_TYPES.length, 31);
  assert.equal(new Set(DEFAULT_TAKEOVER_MIME_TYPES).size, 31);
  for (const c of DEFAULT_CATEGORIES) for (const e of c.extensions) assert.ok(DEFAULT_TAKEOVER_EXTENSIONS.includes(e), e);
  assert.deepEqual(DEFAULT_CATEGORIES.map((c) => c.id), [...CATEGORY_IDS]);
  assert.deepEqual(DEFAULT_CATEGORIES.find((c) => c.id === 'other')!.extensions, []);
});

test('minMb is rounded and clamped, else 5', () => {
  const m = (x: unknown) => v({ takeOver: { ...DEFAULT_DOWNLOADS.takeOver, minMb: x } }).takeOver.minMb;
  assert.equal(m(7.6), 8);
  assert.equal(m(-1), 0);
  assert.equal(m(1e9), 100000);
  assert.equal(m('x'), 5);
  assert.equal(m(NaN), 5);
  assert.equal(m(0), 0);
});

test('parts is rounded and clamped, else 1', () => {
  assert.equal(v({ parts: 0 }).parts, 1);
  assert.equal(v({ parts: 9 }).parts, 6);
  assert.equal(v({ parts: 2.6 }).parts, 3);
  assert.equal(v({ parts: '3' }).parts, 1);
});

test('kbPerSecond is rounded and clamped, else 1000', () => {
  const k = (x: unknown) => v({ speedLimit: { on: true, kbPerSecond: x } }).speedLimit;
  assert.equal(k(5).kbPerSecond, 10);
  assert.equal(k(2e6).kbPerSecond, 1_000_000);
  assert.equal(k(NaN).kbPerSecond, 1000);
  assert.equal(k(250.4).kbPerSecond, 250);
  assert.equal(k(5).on, true);
});

test('booleans fall back to their defaults', () => {
  const s = validate({ version: 1, on: 'yes', takeOver: { on: 1 }, speedLimit: { on: 'x' }, queues: [{ schedule: { on: 'yes' } }] });
  assert.equal(s.on, true);
  assert.equal(s.takeOver.on, true);
  assert.equal(s.speedLimit.on, false);
  assert.equal(s.queues[0]!.schedule.on, false);
  assert.equal(validate({ version: 1, on: false }).on, false);
});

test('extension lists are trimmed, lowercased, filtered, deduplicated and capped', () => {
  const e = (x: unknown) => v({ takeOver: { ...DEFAULT_DOWNLOADS.takeOver, extensions: x } }).takeOver.extensions;
  assert.deepEqual(e(['.MP4 ', 'mp4', 'a b', 'x'.repeat(11), 'ok']), ['mp4', 'ok']);
  const many = Array.from({ length: 201 }, (_, i) => `e${i}`);
  assert.deepEqual(e(many), many.slice(0, 200));
  assert.deepEqual(e([1, null, 'zip']), ['zip']);
  const c = vc([{ id: 'video', folder: 'Video', extensions: Array.from({ length: 101 }, (_, i) => `e${i}`) }]);
  assert.equal(c[0]!.extensions.length, 100);
});

test('a non-array extension list gives the default list', () => {
  assert.deepEqual(v({ takeOver: { ...DEFAULT_DOWNLOADS.takeOver, extensions: 'zip' } }).takeOver.extensions, EXTENSIONS);
  assert.deepEqual(v({ takeOver: 5 }).takeOver, DEFAULT_DOWNLOADS.takeOver);
  assert.deepEqual(vc([{ id: 'video', folder: 'Video', extensions: 'mkv' }])[0]!.extensions, EXTENSIONS.slice(0, 12));
});

test('MIME types are lowercased, filtered and deduplicated', () => {
  const m = (x: unknown) => v({ takeOver: { ...DEFAULT_DOWNLOADS.takeOver, mimeTypes: x } }).takeOver.mimeTypes;
  assert.deepEqual(
    m(['Video/*', 'bad', 'application/zip', 'application/zip', 'application/vnd.oasis.opendocument.*']),
    ['video/*', 'application/zip', 'application/vnd.oasis.opendocument.*'],
  );
  assert.deepEqual(m(['*/*', 'text/', '/x', 'a/b c', 'text/*', 'a/*b']), ['text/*']);
  assert.deepEqual(m(5), MIMES);
  assert.equal(m(Array.from({ length: 101 }, (_, i) => `a/b${i}`)).length, 100);
});

test('categories fill six entries in CATEGORY_IDS order', () => {
  const c = vc([{ id: 'video', folder: 'Movies', extensions: ['mkv'] }]);
  assert.deepEqual(c.map((x) => x.id), [...CATEGORY_IDS]);
  assert.deepEqual(c[0], { id: 'video', folder: 'Movies', extensions: ['mkv'] });
  assert.deepEqual(c.slice(1), LITERAL.categories.slice(1));
  assert.deepEqual(vc('x'), LITERAL.categories);
  assert.deepEqual(vc([null, 3, { id: 'nope', folder: 'X' }]), LITERAL.categories);
});

test('bad folder names give the default folder, a padded one is trimmed', () => {
  const f = (folder: unknown) => vc([{ id: 'music', folder, extensions: [] }])[1]!.folder;
  for (const bad of ['a/b', '..', '', 'x'.repeat(41), '.hidden', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\u0007b', '   ', 5, null]) {
    assert.equal(f(bad), 'Music', String(bad));
  }
  assert.equal(f('  Clips '), 'Clips');
  assert.equal(f('x'.repeat(40)), 'x'.repeat(40));
});

test('other never keeps extensions, and the first entry of an id wins', () => {
  const o = vc([{ id: 'other', folder: 'Misc', extensions: ['zip'] }]);
  assert.deepEqual(o[5], { id: 'other', folder: 'Misc', extensions: [] });
  const twice = vc([{ id: 'music', folder: 'First', extensions: ['mp3'] }, { id: 'music', folder: 'Second', extensions: ['wav'] }]);
  assert.deepEqual(twice[1], { id: 'music', folder: 'First', extensions: ['mp3'] });
});

test('empty or non-array queues give the default queue', () => {
  assert.deepEqual(vq([]), LITERAL.queues);
  assert.deepEqual(vq('x'), LITERAL.queues);
  assert.deepEqual(vq(undefined), LITERAL.queues);
});

test('a broken queue entry is repaired', () => {
  const q = vq([{ id: 'A b', name: '', maxParallel: 99, schedule: { on: 'yes', days: [7, 1, 1, -1], start: '25:00', stop: '7:5' } }]);
  assert.deepEqual(q, [{ id: 'q1', name: 'Queue 1', maxParallel: 8, schedule: { on: false, days: [1], start: '00:00', stop: null } }]);
  const r = vq([{ id: 'x', name: 'N', maxParallel: 'many', schedule: 3 }])[0]!;
  assert.equal(r.maxParallel, 3);
  assert.deepEqual(r.schedule, { on: false, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', stop: null });
  assert.equal(vq([{ id: 'x', name: 'y'.repeat(41), maxParallel: 0 }])[0]!.name, 'Queue 1');
  assert.equal(vq([{ id: 'x', name: ' Night ', maxParallel: 0.2 }])[0]!.maxParallel, 1);
});

test('bad days give all seven, nine queues keep eight', () => {
  assert.deepEqual(vq([{ id: 'a', name: 'A', maxParallel: 1, schedule: { days: [9] } }])[0]!.schedule.days, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(vq([{ id: 'a', name: 'A', maxParallel: 1, schedule: { days: [6, 0, 3.5, 2, 2] } }])[0]!.schedule.days, [0, 2, 6]);
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, name: `N${i}`, maxParallel: 1 }));
  const q = vq(nine);
  assert.equal(q.length, 8);
  assert.equal(q[7]!.id, 'n7');
});

test('a duplicate queue id becomes q<position>, a valid queue is kept', () => {
  const night = { id: 'night', name: 'Night', maxParallel: 2, schedule: { on: true, days: [5, 6], start: '22:30', stop: '06:00' } };
  assert.deepEqual(vq([night]), [night]);
  const q = vq([night, { ...night }]);
  assert.equal(q[0]!.id, 'night');
  assert.equal(q[1]!.id, 'q2');
  const clash = vq([{ id: 'q2', name: 'A', maxParallel: 1 }, { id: 'bad id', name: 'B', maxParallel: 1 }]);
  assert.deepEqual(clash.map((x) => x.id), ['q2', 'q3'], 'q<position> is counted up until it is unique');
  assert.equal(vq([{ id: 'x'.repeat(25), name: 'A', maxParallel: 1 }])[0]!.id, 'q1');
  assert.equal(vq([{ id: 'a-1', name: 'A', maxParallel: 1 }])[0]!.id, 'a-1');
});

test('validate is idempotent', () => {
  const inputs: unknown[] = [
    undefined, 'x', { version: 2 }, DEFAULT_DOWNLOADS,
    { version: 1, parts: 9, takeOver: { minMb: -3, extensions: ['.MP4', 'x y'], mimeTypes: ['Video/*', 'bad'] }, speedLimit: { on: true, kbPerSecond: 3 } },
    { version: 1, categories: [{ id: 'video', folder: ' a/b ', extensions: ['.MKV'] }, { id: 'other', folder: 'Misc', extensions: ['zip'] }] },
    { version: 1, queues: [{ id: 'A b', name: '', maxParallel: 99, schedule: { on: 'yes', days: [7, 1, 1, -1], start: '25:00', stop: '7:5' } }, { id: 'q1' }, { id: 'q1' }] },
  ];
  for (const x of inputs) {
    const once = validate(x);
    assert.deepEqual(validate(once), once);
  }
});
