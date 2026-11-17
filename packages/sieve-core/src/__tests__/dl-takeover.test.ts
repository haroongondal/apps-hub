import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPACE_MARGIN, categoryOf, chooseName, extensionOf, factsFromError, factsFromResponse, isOurs, mimeMatches,
  normaliseMime, parseDisposition, parseRangeTotal, sanitizeFileName, savePath, urlFileName, validatorOf,
  verdict, wantsTakeover,
} from '../dl-takeover.ts';
import type { ChromeItem, ProbeFacts } from '../dl-takeover.ts';
import type { CategorySetting } from '../dl-settings.ts';

// Literal copies of Task 3.1's defaults, so this file needs no code from dl-settings.ts.
const TAKEOVER = {
  on: true,
  minMb: 5,
  extensions: [
    ...'mp4 m4v mkv avi mov wmv flv webm mpg mpeg m2ts 3gp'.split(' '),
    ...'mp3 m4a aac flac wav ogg oga opus wma aiff'.split(' '),
    ...'dmg pkg exe msi apk ipa deb rpm appimage iso img'.split(' '),
    ...'zip rar 7z tar gz tgz bz2 xz zst cab'.split(' '),
    ...'pdf doc docx xls xlsx ppt pptx odt ods odp rtf epub mobi'.split(' '),
  ],
  mimeTypes: [
    'application/octet-stream', 'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed',
    'application/vnd.rar', 'application/x-7z-compressed', 'application/gzip', 'application/x-gzip', 'application/x-tar',
    'application/x-bzip2', 'application/x-xz', 'application/zstd', 'application/x-apple-diskimage',
    'application/x-iso9660-image', 'application/x-msdownload', 'application/vnd.microsoft.portable-executable',
    'application/x-msi', 'application/vnd.android.package-archive', 'application/vnd.debian.binary-package',
    'application/x-rpm', 'application/x-newton-compatible-pkg', 'video/*', 'audio/*', 'application/pdf',
    'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.*', 'application/vnd.oasis.opendocument.*', 'application/rtf',
    'application/epub+zip',
  ],
};
const CATEGORIES: CategorySetting[] = [
  { id: 'video', folder: 'Video', extensions: 'mp4 m4v mkv avi mov wmv flv webm mpg mpeg m2ts 3gp'.split(' ') },
  { id: 'music', folder: 'Music', extensions: 'mp3 m4a aac flac wav ogg oga opus wma aiff'.split(' ') },
  { id: 'programs', folder: 'Programs', extensions: 'dmg pkg exe msi apk ipa deb rpm appimage iso img'.split(' ') },
  { id: 'archives', folder: 'Archives', extensions: 'zip rar 7z tar gz tgz bz2 xz zst cab'.split(' ') },
  { id: 'documents', folder: 'Documents', extensions: 'pdf doc docx xls xlsx ppt pptx odt ods odp rtf epub mobi'.split(' ') },
  { id: 'other', folder: 'Other', extensions: [] },
];

const item = (o: Partial<ChromeItem> = {}): ChromeItem => ({
  url: 'https://h/a.zip', finalUrl: 'https://h/a.zip', referrer: '', mime: 'application/zip', totalBytes: 9_000_000, ...o,
});
const facts = (o: Partial<ProbeFacts> = {}): ProbeFacts => ({
  status: 206, url: 'https://h/a.zip', contentRange: 'bytes 0-0/9000000', contentEncoding: null, mime: 'application/zip',
  etag: null, lastModified: null, disposition: null, contentLength: '1', ...o,
});

test('isOurs: blob, data and filesystem URLs', () => {
  assert.equal(isOurs({ url: 'blob:chrome-extension://abc/uuid', finalUrl: 'blob:chrome-extension://abc/uuid' }, 'abc', []), true);
  assert.equal(isOurs({ url: 'data:text/plain,x', finalUrl: 'data:text/plain,x' }, 'abc', []), true);
  assert.equal(isOurs({ url: 'filesystem:https://x/temporary/a', finalUrl: '' }, 'abc', []), true);
});
test('isOurs: byExtensionId is a second guard', () => {
  assert.equal(isOurs({ url: 'https://h/a', finalUrl: 'https://h/a', byExtensionId: 'abc' }, 'abc', []), true);
  assert.equal(isOurs({ url: 'https://h/a', finalUrl: 'https://h/a', byExtensionId: 'zzz' }, 'abc', []), false);
});
test('isOurs: retry URLs by url and by finalUrl', () => {
  assert.equal(isOurs({ url: 'https://h/a', finalUrl: 'https://h/b' }, 'abc', ['https://h/a']), true);
  assert.equal(isOurs({ url: 'https://h/a', finalUrl: 'https://h/b' }, 'abc', ['https://h/b']), true);
});
test('isOurs: an ordinary http item is not ours', () => {
  assert.equal(isOurs({ url: 'https://h/a', finalUrl: 'https://h/a' }, 'abc', ['https://other/']), false);
  assert.equal(isOurs({ url: 'https://h/a', finalUrl: '' }, 'abc', []), false);
});

test('wantsTakeover: listed type over the floor', () => {
  const r = wantsTakeover({ url: 'https://example.com/files/app.dmg', finalUrl: 'https://example.com/files/app.dmg', referrer: '', mime: 'application/x-apple-diskimage', totalBytes: 6_000_000 }, TAKEOVER, true);
  assert.deepEqual(r, { want: true });
});
test('wantsTakeover: the floor is strictly greater', () => {
  const at = (n: number) => wantsTakeover(item({ totalBytes: n }), TAKEOVER, true);
  assert.deepEqual(at(5_000_000), { want: false, reason: 'too-small' });
  assert.deepEqual(at(5_000_001), { want: true });
});
test('wantsTakeover: unknown size, not-http, off', () => {
  assert.deepEqual(wantsTakeover(item({ totalBytes: -1 }), TAKEOVER, true), { want: false, reason: 'unknown-size' });
  assert.deepEqual(wantsTakeover(item({ totalBytes: NaN }), TAKEOVER, true), { want: false, reason: 'unknown-size' });
  assert.deepEqual(wantsTakeover(item({ url: 'blob:https://x/u', finalUrl: 'blob:https://x/u' }), TAKEOVER, true), { want: false, reason: 'not-http' });
  assert.deepEqual(wantsTakeover(item(), { ...TAKEOVER, on: false }, true), { want: false, reason: 'off' });
  assert.deepEqual(wantsTakeover(item(), TAKEOVER, false), { want: false, reason: 'off' });
});
test('wantsTakeover: type by extension (case-insensitive), MIME and prefix pattern', () => {
  const plain = { referrer: '', mime: 'text/html', totalBytes: 9_000_000 };
  assert.deepEqual(wantsTakeover({ ...plain, url: 'https://example.com/page', finalUrl: 'https://example.com/page' }, TAKEOVER, true), { want: false, reason: 'type' });
  assert.deepEqual(wantsTakeover({ ...plain, mime: 'application/octet-stream', url: 'https://example.com/get?id=3', finalUrl: 'https://example.com/get?id=3' }, TAKEOVER, true), { want: true });
  assert.deepEqual(wantsTakeover({ ...plain, mime: 'application/x-unlisted', url: 'https://x.com/movie.MKV', finalUrl: 'https://x.com/movie.MKV' }, TAKEOVER, true), { want: true });
  assert.deepEqual(wantsTakeover({ ...plain, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', url: 'https://x.com/get', finalUrl: 'https://x.com/get' }, TAKEOVER, true), { want: true });
});
test('wantsTakeover judges finalUrl || url', () => {
  const r = wantsTakeover(item({ url: 'https://h/get?id=1', finalUrl: 'https://cdn/x.mkv', mime: 'application/x-unlisted' }), TAKEOVER, true);
  assert.deepEqual(r, { want: true });
});
test('wantsTakeover: an empty finalUrl is judged by url alone', () => {
  assert.deepEqual(wantsTakeover(item({ finalUrl: '' }), TAKEOVER, true), { want: true });
  assert.deepEqual(wantsTakeover(item({ finalUrl: 'blob:https://x/u' }), TAKEOVER, true), { want: false, reason: 'not-http' });
});
test('wantsTakeover: minMb 0 takes a 1-byte file of a listed type', () => {
  assert.deepEqual(wantsTakeover(item({ totalBytes: 1 }), { ...TAKEOVER, minMb: 0 }, true), { want: true });
});
test('mimeMatches: exact and prefix', () => {
  assert.equal(mimeMatches('Video/MP4; x=1', ['video/*']), true);
  assert.equal(mimeMatches('application/pdf', ['application/pdf']), true);
  assert.equal(mimeMatches('application/pdfx', ['application/pdf']), false);
  assert.equal(mimeMatches('', ['video/*']), false);
});

test('verdict row 1: probe error', () => {
  assert.deepEqual(verdict(item(), facts({ error: 'timed out', status: 0 }), null), { take: false, reason: 'probe-failed' });
});
test('verdict row 2: 200 means no range support', () => {
  assert.deepEqual(verdict(item(), facts({ status: 200 }), null), { take: false, reason: 'no-range' });
});
test('verdict row 3: other statuses', () => {
  for (const s of [403, 404, 429, 503, 302]) assert.deepEqual(verdict(item(), facts({ status: s }), null), { take: false, reason: `status-${s}` });
});
test('verdict row 4: encoded body', () => {
  assert.deepEqual(verdict(item(), facts({ contentEncoding: 'gzip' }), null), { take: false, reason: 'encoded' });
  assert.equal(verdict(item(), facts({ contentEncoding: 'identity' }), null).take, true);
  assert.equal(verdict(item(), facts({ contentEncoding: 'IDENTITY' }), null).take, true);
});
test('verdict row 5: no total', () => {
  assert.deepEqual(verdict(item(), facts({ contentRange: 'bytes 0-0/*' }), null), { take: false, reason: 'no-size' });
  assert.deepEqual(verdict(item(), facts({ contentRange: null }), null), { take: false, reason: 'no-size' });
});
test('verdict row 6: size differs', () => {
  assert.deepEqual(verdict(item(), facts({ contentRange: 'bytes 0-0/9000001' }), null), { take: false, reason: 'size-differs' });
});
test('verdict row 7: type differs, and an empty Chrome mime skips the check', () => {
  assert.deepEqual(verdict(item(), facts({ mime: 'text/html' }), null), { take: false, reason: 'type-differs' });
  assert.equal(verdict(item({ mime: '' }), facts({ mime: 'text/html' }), null).take, true);
  assert.equal(verdict(item({ mime: 'Application/ZIP' }), facts({ mime: 'application/zip; charset=x' }), null).take, true);
});
test('verdict row 8: free space boundary', () => {
  assert.deepEqual(verdict(item(), facts(), 1_000), { take: false, reason: 'no-space' });
  assert.deepEqual(verdict(item(), facts(), 2 * 9_000_000 + SPACE_MARGIN - 1), { take: false, reason: 'no-space' });
  assert.equal(verdict(item(), facts(), 2 * 9_000_000 + SPACE_MARGIN).take, true);
  assert.equal(verdict(item(), facts(), null).take, true);
});
test('verdict row 9: take over with size, mime, validator, final URL and name', () => {
  const v = verdict(item(), facts({ etag: '"abc"', url: 'https://cdn/a.zip', mime: 'Application/Zip; x=1' }), null);
  assert.deepEqual(v, { take: true, size: 9_000_000, mime: 'application/zip', validator: '"abc"', finalUrl: 'https://cdn/a.zip', name: 'a.zip' });
});
test('verdict: the first matching row wins when two facts fail', () => {
  assert.deepEqual(verdict(item(), facts({ contentRange: 'bytes 0-0/9000001', mime: 'text/html' }), 1), { take: false, reason: 'size-differs' });
  assert.deepEqual(verdict(item(), facts({ mime: 'text/html' }), 1), { take: false, reason: 'type-differs' });
});
test('verdict: validator choice', () => {
  const val = (o: Partial<ProbeFacts>) => { const v = verdict(item(), facts(o), null); assert.ok(v.take); return v.validator; };
  assert.equal(val({ etag: 'W/"abc"', lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT' }), 'Wed, 01 Jan 2025 00:00:00 GMT');
  assert.equal(val({}), null);
});
test('verdict: name from Chrome filename, then disposition, then URL', () => {
  const name = (it: Partial<ChromeItem>, f: Partial<ProbeFacts>) => { const v = verdict(item(it), facts(f), null); assert.ok(v.take); return v.name; };
  assert.equal(name({ filename: '/home/x/Downloads/Report.pdf.crdownload' }, {}), 'Report.pdf');
  assert.equal(name({ filename: '/tmp/playwright-artifacts/1b2c-guid' }, { disposition: 'attachment; filename="d.zip"' }), 'd.zip');
  assert.equal(name({ filename: '' }, {}), 'a.zip');
});

test('extensionOf and normaliseMime', () => {
  assert.equal(extensionOf('a.b.GZ'), 'gz');
  for (const n of ['.bashrc', 'file.', 'noext']) assert.equal(extensionOf(n), '');
  assert.equal(normaliseMime('Text/HTML; charset=utf-8'), 'text/html');
  assert.equal(normaliseMime(null), '');
  assert.equal(normaliseMime(undefined), '');
});
test('validatorOf prefers a strong ETag, ignores weak ones, then Last-Modified', () => {
  assert.equal(validatorOf({ etag: '"x"', lastModified: 'L' }), '"x"');
  assert.equal(validatorOf({ etag: 'W/"x"', lastModified: 'L' }), 'L');
  assert.equal(validatorOf({ etag: null, lastModified: 'L' }), 'L');
  assert.equal(validatorOf({ etag: 'W/"x"', lastModified: null }), null);
  assert.equal(validatorOf({ etag: null, lastModified: null }), null);
});
test('factsFromResponse copies the headers and the final URL', () => {
  const h = new Headers({
    'content-range': 'bytes 0-0/10', 'content-encoding': 'identity', 'content-type': 'application/zip', etag: '"e"',
    'last-modified': 'L', 'content-disposition': 'attachment; filename=a.zip', 'content-length': '1', 'retry-after': '7',
  });
  assert.deepEqual(factsFromResponse({ status: 206, url: 'https://h/final', headers: h }), {
    status: 206, url: 'https://h/final', contentRange: 'bytes 0-0/10', contentEncoding: 'identity', mime: 'application/zip',
    etag: '"e"', lastModified: 'L', disposition: 'attachment; filename=a.zip', contentLength: '1', retryAfter: '7',
  });
  const bare = factsFromResponse({ status: 200, url: 'u', headers: new Headers() });
  assert.equal(bare.contentRange, null);
  assert.equal(bare.etag, null);
  assert.equal(bare.retryAfter, null);
  assert.equal(bare.error, undefined);
});
test('factsFromError has the error, status 0 and no headers', () => {
  const f = factsFromError('timed out', 'https://h/a');
  assert.equal(f.error, 'timed out');
  assert.equal(f.status, 0);
  assert.equal(f.url, 'https://h/a');
  assert.equal(f.contentRange, null);
  assert.equal(f.retryAfter, undefined);
});
test('parseRangeTotal', () => {
  assert.equal(parseRangeTotal('bytes 0-0/12345'), 12345);
  for (const bad of ['bytes 0-0/*', 'bytes */500', 'garbage', null]) assert.equal(parseRangeTotal(bad), null);
});
test('parseDisposition', () => {
  assert.equal(parseDisposition('attachment; filename="a b.zip"'), 'a b.zip');
  assert.equal(parseDisposition("attachment; filename*=UTF-8''%E2%82%AC%20rates.txt"), '€ rates.txt');
  assert.equal(parseDisposition("attachment; filename=plain.bin; filename*=UTF-8''star.bin"), 'star.bin');
  assert.equal(parseDisposition('attachment; filename=plain.bin'), 'plain.bin');
  assert.equal(parseDisposition('inline'), null);
  assert.equal(parseDisposition(null), null);
  assert.equal(parseDisposition('attachment; filename="a\\"b.zip"'), 'a"b.zip');
  assert.equal(parseDisposition("attachment; filename=\"ok.bin\"; filename*=UTF-8''%E0%A4%A"), 'ok.bin');
});
test('parseDisposition: a filename* inside a quoted filename value is not a parameter', () => {
  assert.equal(parseDisposition("attachment; filename=\"x; filename*=UTF-8''evil.exe\""), "x; filename*=UTF-8''evil.exe");
  assert.equal(parseDisposition("attachment; filename=\"a.zip\"; filename*=UTF-8''b.zip"), 'b.zip');
  assert.equal(parseDisposition("attachment; filename=\"x; filename*=UTF-8''evil\"; filename*=UTF-8''real.zip"), 'real.zip', 'the first filename* outside the quotes');
});
test('sanitizeFileName: a cut that ends in a space is trimmed before the extension', () => {
  assert.equal(sanitizeFileName('x'.repeat(145) + ' ' + 'y'.repeat(20) + '.mp4'), 'x'.repeat(145) + '.mp4');
});
test('sanitizeFileName', () => {
  const cases: [string, string][] = [
    ['a<b>c:d"e|f?g*h.txt', 'a_b_c_d_e_f_g_h.txt'], ['  report.pdf  ', 'report.pdf'], ['...hidden.txt', 'hidden.txt'],
    ['', 'download'], ['.', 'download'], ['..', 'download'], ['/etc/passwd', 'passwd'], ['C:\\x\\y.zip', 'y.zip'],
    ['a\u0000b.txt', 'a_b.txt'], ['e\u0301.txt', 'é.txt'], ['a   b.txt', 'a b.txt'], ['file.', 'file'], ['name.tar.gz', 'name.tar.gz'],
  ];
  for (const [i, o] of cases) assert.equal(sanitizeFileName(i), o, JSON.stringify(i));
  const long = sanitizeFileName('x'.repeat(300) + '.mp4');
  assert.equal(long.length, 150);
  assert.ok(long.endsWith('.mp4'));
});
test('urlFileName', () => {
  assert.equal(urlFileName('https://x.com/a/b%20c.zip?x=1'), 'b c.zip');
  assert.equal(urlFileName('https://x.com/'), '');
  assert.equal(urlFileName('https://x.com/a/'), '');
  assert.equal(urlFileName('https://x.com/%E0%A4%A'), '%E0%A4%A');
  assert.equal(urlFileName('not a url'), '');
});
test('chooseName', () => {
  assert.equal(chooseName({ disposition: null, url: 'https://x.com/get', mime: 'application/pdf' }), 'get.pdf');
  assert.equal(chooseName({ disposition: null, url: 'https://x.com/a.bin', mime: 'application/pdf' }), 'a.bin');
  assert.equal(chooseName({ disposition: null, url: 'https://x.com/', mime: 'x/unknown' }), 'download');
  assert.equal(chooseName({ chromeFilename: '/d/x.mp4.crdownload', disposition: 'attachment; filename=y.mp4', url: 'https://x.com/z.mp4', mime: '' }), 'x.mp4');
  assert.equal(chooseName({ chromeFilename: 'C:\\d\\guid', disposition: 'attachment; filename=y.mp4', url: 'https://x.com/z.mp4', mime: '' }), 'y.mp4');
  assert.equal(chooseName({ disposition: 'attachment; filename="a/b<c>.zip"', url: 'https://x.com/z', mime: '' }), 'b_c_.zip');
});
test('categoryOf', () => {
  assert.equal(categoryOf('movie.MP4', 'video/mp4', CATEGORIES), 'video');
  assert.equal(categoryOf('x.bin', 'audio/mpeg', CATEGORIES), 'music');
  assert.equal(categoryOf('x.zip', 'application/octet-stream', CATEGORIES), 'archives');
  assert.equal(categoryOf('x', '', CATEGORIES), 'other');
  assert.equal(categoryOf('setup.exe', 'application/x-msdownload', CATEGORIES), 'programs');
  assert.equal(categoryOf('doc.pdf', '', CATEGORIES), 'documents');
  assert.equal(categoryOf('x.mp3', 'video/mp4', CATEGORIES), 'music');
  const custom: CategorySetting[] = [{ id: 'documents', folder: 'Documents', extensions: ['mkv'] }, ...CATEGORIES.filter((c) => c.id !== 'documents')];
  assert.equal(categoryOf('a.mkv', '', custom), 'documents');
});
test('savePath', () => {
  assert.equal(savePath({ id: 'video', folder: 'Video', extensions: [] }, 'a.mp4'), 'Video/a.mp4');
});
