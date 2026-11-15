/**
 * TOTP (RFC 6238) and the `otpauth://totp/` URIs that carry its secrets — the parse half of the
 * vault's Otp.kt (DESIGN §15.1). Both ends must refuse exactly the same URIs with the same words,
 * so every message and bound here mirrors Kotlin. Code generation stays on the phone
 * (javax.crypto); the extension reads and validates only.
 */

export type Digest = 'SHA1' | 'SHA256' | 'SHA512';

/** A parsed `otpauth://totp/` URI, validated field by field. */
export type TotpUri = {
  /** The URI exactly as it was scanned; the vault stores this string. */
  raw: string;
  secret: Uint8Array;
  algorithm: Digest;
  digits: number;
  period: number;
  /** From the `issuer` parameter, else the label's prefix. */
  issuer: string | null;
  /** The label's account part, if any. */
  account: string | null;
};

export const MIN_SECRET_BYTES = 10; // 80 bits
export const MAX_SECRET_BYTES = 64; // 512 bits
export const MIN_PERIOD = 15;
export const MAX_PERIOD = 120;

class OtpRefused extends Error {}

const bad = (why: string): never => {
  throw new OtpRefused(why);
};

/** null when the URI is not a valid TOTP URI. */
export function parseTotp(uri: string): TotpUri | null {
  try {
    return checked(uri);
  } catch (e) {
    if (e instanceof OtpRefused) return null;
    throw e;
  }
}

/** Why the URI is refused, or null when it parses. The scan screen shows this. */
export function totpRefusal(uri: string): string | null {
  try {
    checked(uri);
    return null;
  } catch (e) {
    if (e instanceof OtpRefused) return e.message;
    throw e;
  }
}

// Kotlin's String.equals(ignoreCase) compares chars case-insensitively; uppercasing both matches it here.
const eqIgnoreCase = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase();

const DIGESTS: readonly Digest[] = ['SHA1', 'SHA256', 'SHA512'];
const digestOf = (s: string): Digest | null => DIGESTS.find((d) => eqIgnoreCase(s, d)) ?? null;

// Java's Character.isWhitespace (what Kotlin trims and filters on), not JavaScript's \s, which also eats non-breaking spaces.
const WS = '\\t\\n\\x0B\\f\\r\\x1C-\\x1F \\u1680\\u2000-\\u200A\\u2028\\u2029\\u205F\\u3000';
const LEFT_WS = new RegExp(`^[${WS}]+`);
const RIGHT_WS = new RegExp(`[${WS}]+$`);
const WS_GLOBAL = new RegExp(`[${WS}]`, 'g');
const trim = (s: string): string => s.replace(LEFT_WS, '').replace(RIGHT_WS, '');

// Kotlin String.toIntOrNull: an optional sign, then decimal digits, inside Int's range.
const intOrNull = (text: string): number | null => {
  if (!/^[+-]?[0-9]+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= -2147483648 && n <= 2147483647 ? n : null;
};

function checked(uri: string): TotpUri {
  const trimmed = trim(uri);
  const schemeEnd = trimmed.indexOf(':');
  if (schemeEnd <= 0 || !eqIgnoreCase(trimmed.slice(0, schemeEnd), 'otpauth')) {
    bad('This QR is not an authenticator code');
  }
  const rest = trimmed.slice(schemeEnd + 1);
  const afterSlashes = rest.startsWith('//') ? rest.slice(2) : rest;
  const typeEnd = afterSlashes.indexOf('/');
  if (typeEnd < 0) bad('This QR is not an authenticator code');
  const type = afterSlashes.slice(0, typeEnd);
  if (eqIgnoreCase(type, 'hotp')) bad('Counter-based codes are not supported');
  if (!eqIgnoreCase(type, 'totp')) bad('This QR is not an authenticator code');

  const body = afterSlashes.slice(typeEnd + 1);
  const queryStart = body.indexOf('?');
  if (queryStart < 0) bad('The QR holds no secret key');

  let secretText: string | null = null;
  let algorithm: Digest | null = null;
  let digits: number | null = null;
  let period: number | null = null;
  let issuerParam: string | null = null;
  for (const pair of body.slice(queryStart + 1).split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const key = eq < 0 ? pair : pair.slice(0, eq);
    const value = eq < 0 ? '' : percentDecode(pair.slice(eq + 1));
    switch (key.toLowerCase()) {
      case 'secret':
        if (secretText === null) secretText = value.replaceAll(' ', '');
        break;
      case 'algorithm':
        if (algorithm === null && value !== '') {
          algorithm = digestOf(value);
          if (algorithm === null) bad("The QR names an algorithm Strongroom doesn't know");
        }
        break;
      case 'digits':
        if (digits === null) {
          digits = intOrNull(value);
          if (digits === null) bad("The QR's digit count is not a number");
        }
        break;
      case 'period':
        if (period === null) {
          period = intOrNull(value);
          if (period === null) bad("The QR's period is not a number");
        }
        break;
      case 'issuer':
        if (issuerParam === null) issuerParam = trim(value) || null;
        break;
      default:
        break; // unknown parameters are ignored (§15.1)
    }
  }
  const label = trim(percentDecode(body.slice(0, queryStart)));
  let issuer = issuerParam;
  if (issuer === null && label.includes(':')) issuer = trim(label.slice(0, label.indexOf(':'))) || null;

  const secret = decodeBase32(secretText ?? bad('The QR holds no secret key')) ?? bad("The QR's secret is not valid base32");
  if (secret.length < MIN_SECRET_BYTES) bad('The secret is too short (needs at least 80 bits)');
  if (secret.length > MAX_SECRET_BYTES) bad('The secret is too long (at most 512 bits)');
  const digitCount = digits ?? 6;
  const periodSeconds = period ?? 30;
  if (digitCount !== 6 && digitCount !== 8) bad('Digits must be 6 or 8');
  if (periodSeconds < MIN_PERIOD || periodSeconds > MAX_PERIOD) bad(`The period must be ${MIN_PERIOD}–${MAX_PERIOD} seconds`);

  const colon = label.indexOf(':');
  const account = trim(colon < 0 ? label : label.slice(colon + 1)) || null;
  return { raw: uri, secret, algorithm: algorithm ?? 'SHA1', digits: digitCount, period: periodSeconds, issuer, account };
}

/** RFC 4648 base32: case-insensitive, `=` padding optional, whitespace ignored, non-canonical trailing bits discarded. */
export function decodeBase32(text: string): Uint8Array | null {
  const chars = text.replace(WS_GLOBAL, '').replaceAll('=', '');
  if (chars.length === 0) return null;
  const out = new Uint8Array(Math.floor((chars.length * 5) / 8));
  let buffer = 0;
  let bits = 0;
  let next = 0;
  for (const c of chars) {
    const value = c >= 'A' && c <= 'Z'
      ? c.charCodeAt(0) - 65
      : c >= 'a' && c <= 'z'
      ? c.charCodeAt(0) - 97
      : c >= '2' && c <= '7'
      ? c.charCodeAt(0) - 50 + 26
      : -1;
    if (value < 0) return null;
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[next++] = (buffer >> bits) & 0xff;
      buffer &= (1 << bits) - 1;
    }
  }
  return out;
}

// Percent-decoding for the label and parameter values: `+` stays a plus, malformed escapes fail.
// Each kept char contributes its low 8 bits, as Kotlin's Char.code.toByte() does.
const HEX_ESCAPE = /^([+-]?)([0-9a-fA-F]+)$/;
// ignoreBOM keeps a leading U+FEFF as content, like Kotlin's String(bytes, UTF_8).
const UTF8 = new TextDecoder('utf-8', { ignoreBOM: true });

function percentDecode(text: string): string {
  if (!text.includes('%')) return text;
  const bytes: number[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c !== '%') {
      bytes.push(c.charCodeAt(0) & 0xff);
      i++;
      continue;
    }
    if (i + 2 >= text.length) bad('This QR is malformed');
    // Kotlin parses the two chars after % with toIntOrNull(16), sign included; the byte keeps the low 8 bits.
    const match = HEX_ESCAPE.exec(text.slice(i + 1, i + 3));
    const [sign, digits] = match === null ? bad('This QR is malformed') : [match[1], match[2]];
    let value = 0;
    for (const digit of digits) value = value * 16 + parseInt(digit, 16);
    bytes.push((sign === '-' ? -value : value) & 0xff);
    i += 3;
  }
  return UTF8.decode(new Uint8Array(bytes));
}
