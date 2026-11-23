import { isKnownAuthority } from './names.ts';

export type ColumnType = 'long' | 'int' | 'double' | 'string' | 'long?' | 'int?' | 'double?' | 'string?';

/** The column types a row field of TS type T may use. `never` (so a compile error) for booleans, objects, arrays. */
export type ColumnFor<T> = [T] extends [number]
  ? 'long' | 'int' | 'double'
  : [T] extends [string]
    ? 'string'
    : [T] extends [number | null]
      ? 'long?' | 'int?' | 'double?'
      : [T] extends [string | null]
        ? 'string?'
        : never;

export interface ShareSpec<Row extends object> {
  authority: string;
  /** Lowercase segments joined by `/`, at most 3. */
  path: string;
  /** One entry per row field; tsc fails when a field is added, dropped or given a type that disagrees. */
  columns: { [K in keyof Row]-?: ColumnFor<Row[K]> };
  /** Default 200, at most 500. */
  maxRows?: number;
  description: string;
}

export interface Share<Row extends object> {
  readonly authority: string;
  readonly path: string;
  /** Ordered column names. */
  readonly columns: readonly (keyof Row & string)[];
  readonly types: Readonly<Record<keyof Row & string, ColumnType>>;
  readonly maxRows: number;
  readonly description: string;
  /** `content://<authority>/<path>[/<id>...]`; ids are non-negative safe integers, never free text. */
  uri(...ids: number[]): string;
}

export const DEFAULT_MAX_ROWS = 200;
export const HARD_MAX_ROWS = 500;
export const MAX_COLUMNS = 24;
const MAX_PATH_SEGMENTS = 3;
const PATH_SEGMENT = /^[a-z][a-z0-9_]*$/;
const COLUMN_NAME = /^[a-z][a-z0-9_]*$/;
const INT32_MAX = 2147483647;
const COLUMN_TYPES: readonly string[] = ['long', 'int', 'double', 'string', 'long?', 'int?', 'double?', 'string?'];

// Long words are refused anywhere in the name (so `access_token_hash` fails too); short words
// that sit inside harmless names (pinned, spinner, speed, keyboard, decode_ms) only count as a whole `_` word.
const SENSITIVE_SUBSTRINGS = ['password', 'passwd', 'passcode', 'passphrase', 'secret', 'token', 'apikey', 'api_key', 'private', 'credential', 'session', 'cookie', 'mnemonic', 'cardnumber', 'totp', 'hotp'];
const SENSITIVE_WORDS = ['pin', 'otp', 'seed', 'cvv', 'cvc', 'code', 'key', 'pass', 'pwd', 'passcode', 'auth', 'iban', 'card'];

/**
 * True for names a share must never serve. A whole `_` word counts, plural or not (`pins`, `keys`);
 * `pincode` (no `_`) does not, so name such a column `pin_code`. The list is deliberately blunt: an
 * author renames instead of arguing, so `status_code` (word `code`) and `item_key` (word `key`) are
 * refused too; name them `status_id` and `item_ref`. Only names are checked, never values.
 */
export function isSensitiveName(name: string): boolean {
  return SENSITIVE_SUBSTRINGS.some((s) => name.includes(s)) || name.split('_').some((w) => SENSITIVE_WORDS.includes(w) || SENSITIVE_WORDS.includes(w.replace(/s$/, '')));
}

/**
 * Declares a read-only content provider path. Rows are flat and typed (numbers and strings,
 * nullable or not). A column NAMED like a password, token, code or key is refused (see
 * `isSensitiveName`); that is a name check only and says nothing about the values a provider puts
 * in a column, and it binds a provider only when a JVM test ties the provider's column array and
 * row cap to this share's fixture (README, "Add a share"). Text that came from other people
 * (messages, names, titles) must not appear in a share unless the share's README entry says
 * it is untrusted data, which the receiving app must never treat as instructions.
 *
 * Curried so `Row` is explicit while the spec is checked against it:
 * `defineShare<MyRow>()({ ... })`.
 */
export function defineShare<Row extends object>() {
  return (spec: ShareSpec<Row>): Share<Row> => {
    const { authority, path, description } = spec;
    if (!isKnownAuthority(authority)) throw new Error(`share authority ${JSON.stringify(authority)} is not com.haroon.<app>.applink or a known legacy authority`);
    const segments = typeof path === 'string' ? path.split('/') : [];
    if (segments.length < 1 || segments.length > MAX_PATH_SEGMENTS || !segments.every((s) => PATH_SEGMENT.test(s))) {
      throw new Error(`share path ${JSON.stringify(path)} must be 1 to ${MAX_PATH_SEGMENTS} lowercase segments like a_b/c`);
    }
    const types = { ...spec.columns } as Record<string, ColumnType>;
    const names = Object.keys(types);
    if (names.length < 1 || names.length > MAX_COLUMNS) throw new Error(`a share needs 1 to ${MAX_COLUMNS} columns, got ${names.length}`);
    for (const name of names) {
      if (!COLUMN_NAME.test(name)) throw new Error(`column ${JSON.stringify(name)} must be snake_case`);
      if (isSensitiveName(name)) throw new Error(`column ${JSON.stringify(name)} looks sensitive: a share serves nothing sensitive by construction`);
      if (!COLUMN_TYPES.includes(types[name])) throw new Error(`column ${name} has unknown type ${JSON.stringify(types[name])}`);
    }
    const maxRows = spec.maxRows ?? DEFAULT_MAX_ROWS;
    if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > HARD_MAX_ROWS) throw new Error(`maxRows must be an integer from 1 to ${HARD_MAX_ROWS}, got ${maxRows}`);
    return Object.freeze({
      authority,
      path,
      columns: Object.freeze(names) as readonly (keyof Row & string)[],
      types: Object.freeze(types) as Readonly<Record<keyof Row & string, ColumnType>>,
      maxRows,
      description,
      uri(...ids: number[]) {
        for (const id of ids) if (!Number.isSafeInteger(id) || id < 0) throw new Error(`uri ids must be non-negative safe integers, got ${String(id)}`);
        return `content://${authority}/${[path, ...ids].join('/')}`;
      },
    });
  };
}

/** Cuts a result to the share's row cap. */
export function clampRows<Row extends object>(share: Share<Row>, rows: readonly Row[]): Row[] {
  return rows.slice(0, share.maxRows);
}

/** Throws unless `row` has exactly the share's keys with values of the declared runtime types. A provider's tests run it on sample fixtures. */
export function assertRowShape<Row extends object>(share: Share<Row>, row: unknown): asserts row is Row {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) throw new Error('row must be an object');
  const keys = Object.keys(row);
  const missing = share.columns.filter((c) => !keys.includes(c));
  const extra = keys.filter((k) => !(share.columns as readonly string[]).includes(k));
  if (missing.length || extra.length) throw new Error(`row keys differ: missing [${missing}], extra [${extra}]`);
  for (const col of share.columns) {
    const type = share.types[col];
    const value = (row as Record<string, unknown>)[col];
    if (type.endsWith('?') && value === null) continue;
    const base = type.replace('?', '');
    const ok = base === 'string' ? typeof value === 'string'
      : base === 'double' ? typeof value === 'number' && Number.isFinite(value)
      : base === 'int' ? Number.isSafeInteger(value) && Math.abs(value as number) <= INT32_MAX
      : Number.isSafeInteger(value);
    if (!ok) throw new Error(`column ${col} must be ${type}, got ${value === null ? 'null' : typeof value}`);
  }
}
