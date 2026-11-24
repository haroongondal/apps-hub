import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimedKind, classifyShare, cleanName, sniffFormat, type RawShare } from '../shared.ts';

const text = (s: string) => [...s].map(c => c.charCodeAt(0));
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];
const MP4 = [0, 0, 0, 0x20, ...text('ftypisom'), 0, 0, 2, 0];
const HEIC = [0, 0, 0, 0x18, ...text('ftypheic'), 0, 0, 0, 0];
const WEBP = [...text('RIFF'), 1, 2, 3, 4, ...text('WEBPVP8 ')];

const raw = (over: Partial<RawShare> & { head: number[] }): RawShare => ({ uri: 'file:///f/a.part', name: 'a.jpg', mime: 'image/jpeg', bytes: 100, ...over });

test('the first bytes decide the format', () => {
  assert.equal(sniffFormat(JPEG), 'jpeg');
  assert.equal(sniffFormat(PNG), 'png');
  assert.equal(sniffFormat(MP4), 'mp4');
  assert.equal(sniffFormat([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]), 'matroska');
  assert.equal(sniffFormat(HEIC), 'unsupported-image');
  assert.equal(sniffFormat(WEBP), 'unsupported-image');
  assert.equal(sniffFormat(text('GIF89a')), 'unsupported-image');
  assert.equal(sniffFormat(text('%PDF-1.7 hello')), undefined);
  assert.equal(sniffFormat([]), undefined);
});

test('the sender claim uses the type, then the file ending when the type says nothing', () => {
  assert.equal(claimedKind('image/png; charset=x', 'x'), 'image');
  assert.equal(claimedKind('video/quicktime', 'x'), 'video');
  assert.equal(claimedKind('application/octet-stream', 'clip.MOV'), 'video');
  assert.equal(claimedKind('*/*', 'a.jpeg'), 'image');
  assert.equal(claimedKind('', 'a.txt'), undefined);
  assert.equal(claimedKind('text/plain', 'a.jpg'), undefined);
});

test('a name from another app loses folders, control and direction characters', () => {
  assert.equal(cleanName('../../etc/passwd.jpg', 'x'), 'passwd');
  assert.equal(cleanName('C:\\Users\\me\\holiday.png', 'x'), 'holiday');
  assert.equal(cleanName('evil\u202Egnp.exe\u0000.jpg', 'x'), 'evilgnp.exe');
  assert.equal(cleanName('a:b*c?.mp4', 'x'), 'a_b_c_');
  assert.equal(cleanName('.hidden.jpg', 'x'), 'hidden');
  assert.equal(cleanName('...', 'Picture'), 'Picture');
  assert.equal(Array.from(cleanName('é'.repeat(200), 'x')).length, 80);
});

test('the bytes beat the claimed type and the file ending', () => {
  const { items, refused } = classifyShare([
    raw({ uri: 'u1', name: 'holiday.png', mime: 'image/png', head: JPEG }),
    raw({ uri: 'u2', name: 'clip.jpg', mime: 'image/jpeg', head: MP4 }),
    raw({ uri: 'u3', name: 'photo.dat', mime: 'application/octet-stream', head: PNG }),
  ]);
  assert.deepEqual(items.map(i => [i.name, i.kind, i.format]), [['holiday.jpg', 'image', 'jpeg'], ['clip.mp4', 'video', 'mp4'], ['photo.png', 'image', 'png']]);
  assert.deepEqual(refused, []);
});

test('a file that is not a picture or video is refused and its copy is discarded', () => {
  const batch = classifyShare([
    raw({ uri: 'u1', name: 'notes.jpg', mime: 'image/jpeg', head: text('<html><script>') }),
    raw({ uri: 'u2', name: 'a.pdf', mime: 'application/pdf', head: text('%PDF-1.7') }),
    raw({ uri: 'u3', name: 'pic.heic', mime: 'image/heic', head: HEIC }),
  ]);
  assert.deepEqual(batch.items, []);
  assert.deepEqual(batch.discard, ['u1', 'u2', 'u3']);
  assert.deepEqual(batch.refused, [
    'notes looks damaged or isn\'t really a picture or video.',
    'a isn\'t a picture or video Design Editor can use.',
    'pic isn\'t a JPEG or PNG picture, so the tools can\'t use it.',
  ]);
});

test('a copy that failed says why, in plain words, whatever its bytes', () => {
  const { refused, items } = classifyShare([
    raw({ uri: 'u1', name: 'big.mp4', head: MP4, problem: 'too_big' }),
    raw({ uri: 'u2', name: 'x.mp4', head: MP4, problem: 'no_space' }),
    raw({ uri: 'u3', name: 'y.jpg', head: [], problem: 'unreadable' }),
  ]);
  assert.deepEqual(items, []);
  assert.deepEqual(refused, ['big is too big to add (over 2 GB).', "There isn't enough space on your phone to add x.", "y couldn't be read. Share it again."]);
});

test('the same picture twice is kept once; two with the same name get their own names', () => {
  const { items, discard } = classifyShare([
    raw({ uri: 'u1', head: JPEG }),
    raw({ uri: 'u2', head: JPEG }),
    raw({ uri: 'u3', head: PNG, bytes: 5, name: 'a.png', mime: 'image/png' }),
    raw({ uri: 'u4', head: PNG, bytes: 6, name: 'a.png', mime: 'image/png' }),
  ]);
  assert.deepEqual(items.map(i => i.name), ['a.jpg', 'a.png', 'a 2.png']);
  assert.deepEqual(discard, ['u2']);
});

test('no more than the cap are kept, and the rest are discarded with one message', () => {
  const many = Array.from({ length: 25 }, (_, i) => raw({ uri: `u${i}`, name: `p${i}.jpg`, head: JPEG, bytes: i + 1 }));
  const { items, refused, discard } = classifyShare(many, 20);
  assert.equal(items.length, 20);
  assert.equal(discard.length, 5);
  assert.deepEqual(refused, ['Only the first 20 were added.']);
});

test('a hostile name never becomes a path and keeps the right ending', () => {
  const { items } = classifyShare([raw({ name: '../../files/secret.sh', mime: 'video/mp4', head: MP4 })]);
  assert.equal(items[0].name, 'secret.mp4');
  assert.ok(!items[0].name.includes('/'));
});
