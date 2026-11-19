import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { equalBytes } from '../crypto.ts';
import { decodeBase32, parseTotp, totpCode, totpRefusal, totpState } from '../otp.ts';

// The phone's OtpTest reads this same vector file, so both ends exercise exactly the same rows.
const path = new URL(
  '../../../../apps/strongroom/modules/strongroom-vault/android/src/test/resources/otp-vectors.json',
  import.meta.url,
);
type Vectors = {
  secrets: Record<string, string>;
  rfc6238: { t: number; sha1: string; sha256: string; sha512: string }[];
  sixDigit: { t: number; digest: string; code: string }[];
  periodEdges: { period: number; t: number; code: string }[];
};
const vectors = JSON.parse(readFileSync(path, 'utf8')) as Vectors;
const secrets = vectors.secrets;
const sha1 = secrets['sha1']!;

const uri = (secret: string, o: { algorithm?: string; digits?: number; period?: number } = {}): string => {
  let u = `otpauth://totp/RFC:test@rfc-editor.org?secret=${secret}`;
  if (o.algorithm !== undefined) u += `&algorithm=${o.algorithm}`;
  if (o.digits !== undefined) u += `&digits=${o.digits}`;
  if (o.period !== undefined) u += `&period=${o.period}`;
  return u;
};

test('defaults are SHA-1, six digits, thirty seconds, and the raw string is kept whole', () => {
  const t = parseTotp(`otpauth://totp/alice@example.com?secret=${sha1}`)!;
  assert.deepEqual(t, {
    raw: `otpauth://totp/alice@example.com?secret=${sha1}`,
    secret: decodeBase32(sha1),
    algorithm: 'SHA1', digits: 6, period: 30, issuer: null, account: 'alice@example.com',
  });
});

test('the issuer parameter beats the label prefix, and the label prefix stands without one', () => {
  const t = parseTotp(`otpauth://totp/Wrong:bob?secret=${sha1}&issuer=Right`)!;
  assert.deepEqual([t.issuer, t.account], ['Right', 'bob']);
  const t2 = parseTotp(`otpauth://totp/Example:alice@example.com?secret=${sha1}`)!;
  assert.deepEqual([t2.issuer, t2.account], ['Example', 'alice@example.com']);
});

test('the label is percent-decoded, and a plus stays a plus', () => {
  const t = parseTotp(`otpauth://totp/Ex%20ample:al%3Aice?secret=${sha1}`)!;
  assert.deepEqual([t.issuer, t.account], ['Ex ample', 'al:ice']);
  assert.equal(parseTotp(`otpauth://totp/a+b?secret=${sha1}`)!.account, 'a+b');
});

test('scheme, type, parameter names and base32 case do not matter', () => {
  const t = parseTotp(`OTPAUTH://TOTP/a:b?SECRET=${sha1.toLowerCase()}&ALGORITHM=sha256&DIGITS=8&PERIOD=60`)!;
  assert.deepEqual({ algorithm: t.algorithm, digits: t.digits, period: t.period }, { algorithm: 'SHA256', digits: 8, period: 60 });
});

test('padded and spaced secrets decode like the plain one', () => {
  const plain = parseTotp(`otpauth://totp/x?secret=${sha1}`)!.secret;
  const padded = parseTotp(`otpauth://totp/x?secret=${sha1}=`)!.secret;
  const spaced = parseTotp(`otpauth://totp/x?secret=${sha1.match(/.{4}/g)!.join(' ')}`)!.secret;
  assert.ok(equalBytes(plain, padded) && equalBytes(plain, spaced));
});

test('unknown parameters are ignored, and the first occurrence wins', () => {
  const t = parseTotp(`otpauth://totp/x?secret=${sha1}&image=https://x/y.png&counter=3&foo=bar`)!;
  assert.deepEqual({ digits: t.digits, issuer: t.issuer }, { digits: 6, issuer: null });
  assert.equal(parseTotp(`otpauth://totp/x?secret=${sha1}&digits=8&digits=6`)!.digits, 8);
});

test('refusals name the problem', () => {
  const refusals: [string, string][] = [
    [`https://example.com/qr?secret=${sha1}`, 'This QR is not an authenticator code'],
    ['not a uri at all', 'This QR is not an authenticator code'],
    [`otpauth://hotp/x?secret=${sha1}&counter=0`, 'Counter-based codes are not supported'],
    ['otpauth://totp/x?issuer=y', 'The QR holds no secret key'],
    ['otpauth://totp/x?secret=JBSWY1DP', "The QR's secret is not valid base32"], // '1' is not base32
    ['otpauth://totp/x?secret=JBSWY3DPEHPK3PX', 'The secret is too short (needs at least 80 bits)'], // 15 chars = 9 bytes
    [`otpauth://totp/x?secret=${secrets['sha512']}${sha1}`, 'The secret is too long (at most 512 bits)'], // 68 bytes
    [`otpauth://totp/x?secret=${sha1}&algorithm=SHA3`, "The QR names an algorithm Strongroom doesn't know"],
    [`otpauth://totp/x?secret=${sha1}&digits=7`, 'Digits must be 6 or 8'],
    [`otpauth://totp/x?secret=${sha1}&digits=six`, "The QR's digit count is not a number"],
    [`otpauth://totp/x?secret=${sha1}&period=14`, 'The period must be 15–120 seconds'],
    [`otpauth://totp/x?secret=${sha1}&period=abc`, "The QR's period is not a number"],
    [`otpauth://totp/x?secret=${sha1}&issuer=%zz`, 'This QR is malformed'],
  ];
  for (const [bad, message] of refusals) assert.equal(totpRefusal(bad), message, bad);
  assert.equal(totpRefusal(`otpauth://totp/x?secret=${sha1}`), null);
  assert.equal(parseTotp(`otpauth://hotp/x?secret=${sha1}&counter=0`), null);
});

test('base32 boundaries', () => {
  assert.equal(decodeBase32(''), null);
  assert.equal(decodeBase32('JBSWY1DP'), null); // '1' is not in the alphabet
  assert.equal(decodeBase32('JBSWY3DP')!.length, 5); // 8 chars -> 5 bytes exactly
  assert.equal(decodeBase32('JBSWY3DPEH')!.length, 6); // 10 chars -> 6 bytes, 2 trailing bits discarded
  assert.equal(decodeBase32('77')![0], 0xff); // two 11111 groups -> one 11111111 byte
});

test('RFC 6238 appendix B, eight digits, all three digests', () => {
  for (const row of vectors.rfc6238) {
    for (const digest of ['sha1', 'sha256', 'sha512'] as const) {
      const u = uri(secrets[digest]!, { algorithm: digest.toUpperCase(), digits: 8 });
      assert.equal(totpCode(u, row.t), row[digest], `t=${row.t} ${digest}`);
      assert.equal(totpState(parseTotp(u)!, row.t).code, row[digest], `state t=${row.t} ${digest}`);
    }
  }
});

test('six-digit vectors, all three digests', () => {
  for (const row of vectors.sixDigit) {
    const u = uri(secrets[row.digest]!, { algorithm: row.digest.toUpperCase(), digits: 6 });
    assert.equal(totpCode(u, row.t), row.code, `t=${row.t} ${row.digest}`);
  }
});

test('period edges: the counter is floor(unix / period)', () => {
  for (const row of vectors.periodEdges) {
    const u = uri(sha1, { period: row.period });
    assert.equal(totpCode(u, row.t), row.code, `t=${row.t} period=${row.period}`);
  }
});

test('the string convenience parses each time and refuses a non-TOTP URI', () => {
  assert.equal(totpCode(uri(sha1), 59), '287082');
  assert.equal(totpCode(`otpauth://hotp/x?secret=${sha1}&counter=0`, 59), null);
  assert.equal(totpCode('not a uri', 59), null);
});

test('state counts down and never reads zero', () => {
  const t = parseTotp(uri(sha1))!;
  assert.deepEqual(totpState(t, 0), { code: totpCode(uri(sha1), 0), secondsLeft: 30, period: 30 });
  assert.equal(totpState(t, 60).secondsLeft, 30);
  assert.equal(totpState(t, 61).secondsLeft, 29);
  assert.equal(totpState(t, 89).secondsLeft, 1);
  assert.equal(totpState(t, 60).code, totpCode(uri(sha1), 60));
  assert.equal(totpState(t, 60).period, 30);
  const eight = parseTotp(uri(sha1, { digits: 8 }))!;
  assert.equal(totpState(eight, 45).code.length, 8);
});
