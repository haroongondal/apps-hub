import { actionName } from './names.ts';

export const MAX_EXTRAS = 8;
export const MAX_STRING_CHARS = 2000;
export const MAX_ARRAY_ITEMS = 20;
export const MAX_ARRAY_ITEM_CHARS = 200;
export const MAX_TOTAL_CHARS = 8000;
export const MAX_RESULT_MESSAGE_CHARS = 200;

export type ExtraType = 'string' | 'long' | 'boolean' | 'stringArray';
/** `max` only lowers a limit: chars for a string, items for a stringArray. A long or boolean takes none. */
export interface ExtraSpec { type: ExtraType; max?: number; required?: boolean }

type ExtraValue<S> = S extends { type: 'string' } ? string
  : S extends { type: 'long' } ? number
  : S extends { type: 'boolean' } ? boolean
  : S extends { type: 'stringArray' } ? string[]
  : never;
export type ExtrasOf<E> =
  { [K in keyof E as E[K] extends { required: true } ? K : never]: ExtraValue<E[K]> } &
  { [K in keyof E as E[K] extends { required: true } ? never : K]?: ExtraValue<E[K]> };

/**
 * `screen` is the literal `true` on purpose: an action is an exported activity that ALWAYS shows
 * the user a screen before doing anything, so there is no headless variant to declare.
 * String extras that came from other people are untrusted data for the receiving app (in Deputy:
 * the untrusted block), never instructions.
 */
export interface ActionSpec<E extends Record<string, ExtraSpec>> {
  app: string;
  /** Upper snake case, e.g. SEND_DRAFT. */
  name: string;
  extras: E;
  screen: true;
  description: string;
}

export interface Action<E extends Record<string, ExtraSpec>> {
  readonly app: string;
  /** The full intent action, `com.haroon.<app>.action.<NAME>`. */
  readonly name: string;
  readonly extras: Readonly<E>;
  readonly screen: true;
  readonly description: string;
}

const EXTRA_KEY = /^[a-z][A-Za-z0-9]*$/;

export function defineAction<const E extends Record<string, ExtraSpec>>(spec: ActionSpec<E>): Action<E> {
  const name = actionName(spec.app, spec.name);
  const keys = Object.keys(spec.extras);
  if (keys.length > MAX_EXTRAS) throw new Error(`an action takes at most ${MAX_EXTRAS} extras, got ${keys.length}`);
  for (const key of keys) {
    if (!EXTRA_KEY.test(key)) throw new Error(`extra key ${JSON.stringify(key)} must match ${EXTRA_KEY}`);
    const { type, max } = spec.extras[key];
    if (!['string', 'long', 'boolean', 'stringArray'].includes(type)) throw new Error(`extra ${key} has unknown type ${JSON.stringify(type)}`);
    if (max === undefined) continue;
    const limit = type === 'string' ? MAX_STRING_CHARS : type === 'stringArray' ? MAX_ARRAY_ITEMS : 0;
    if (!Number.isInteger(max) || max < 1 || max > limit) throw new Error(`extra ${key} max must be an integer from 1 to ${limit}, got ${max}`);
  }
  return Object.freeze({ app: spec.app, name, extras: Object.freeze({ ...spec.extras }), screen: true as const, description: spec.description });
}

export type ExtrasCheck<E extends Record<string, ExtraSpec>> = { ok: true; extras: ExtrasOf<E> } | { ok: false; reason: string };

/** Checks the extras of an incoming intent. Never throws; strings come back untouched (no trimming), but a NUL is refused. Lengths count UTF-16 units, as Kotlin's String.length does. */
export function validateExtras<E extends Record<string, ExtraSpec>>(action: Action<E>, raw: Record<string, unknown>): ExtrasCheck<E> {
  try {
    return check(action, raw);
  } catch {
    return { ok: false, reason: 'extras could not be read' };
  }
}

function check<E extends Record<string, ExtraSpec>>(action: Action<E>, raw: Record<string, unknown>): ExtrasCheck<E> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'extras must be an object' };
  const keys = Object.keys(raw);
  if (keys.length > MAX_EXTRAS) return { ok: false, reason: `more than ${MAX_EXTRAS} extras` };
  const has = (k: string) => Object.prototype.hasOwnProperty.call(action.extras, k);
  for (const key of keys) if (!has(key)) return { ok: false, reason: `unknown extra ${key}` };
  let total = 0;
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries<ExtraSpec>(action.extras)) {
    const value = raw[key];
    if (value === undefined) {
      if (spec.required) return { ok: false, reason: `missing extra ${key}` };
      continue;
    }
    if (spec.type === 'long') {
      if (!Number.isSafeInteger(value)) return { ok: false, reason: `${key} must be a whole number` };
    } else if (spec.type === 'boolean') {
      if (typeof value !== 'boolean') return { ok: false, reason: `${key} must be true or false` };
    } else if (spec.type === 'string') {
      if (typeof value !== 'string') return { ok: false, reason: `${key} must be text` };
      if (value.length > (spec.max ?? MAX_STRING_CHARS)) return { ok: false, reason: `${key} is too long` };
      if (value.includes('\0')) return { ok: false, reason: `${key} contains a NUL character` };
      total += value.length;
    } else {
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) return { ok: false, reason: `${key} must be a list of text` };
      if (value.length > (spec.max ?? MAX_ARRAY_ITEMS)) return { ok: false, reason: `${key} has too many items` };
      for (const item of value) {
        if (item.length > MAX_ARRAY_ITEM_CHARS) return { ok: false, reason: `${key} has an item that is too long` };
        if (item.includes('\0')) return { ok: false, reason: `${key} contains a NUL character` };
        total += item.length;
      }
    }
    out[key] = value;
  }
  if (total > MAX_TOTAL_CHARS) return { ok: false, reason: `extras hold more than ${MAX_TOTAL_CHARS} characters` };
  return { ok: true, extras: out as ExtrasOf<E> };
}

/** What an action answers with. `message` is plain words for the user, never a raw error. */
export interface ActionResult { status: 'done' | 'cancelled' | 'failed'; code?: string; message?: string }

// Every key of ActionResult; the Record type makes tsc fail if one is added or dropped here.
const resultKeys: Record<keyof ActionResult, true> = { status: true, code: true, message: true };
export const RESULT_KEYS = Object.keys(resultKeys) as (keyof ActionResult)[];

const RESULT_CODE = /^[a-z][a-z0-9_]{0,39}$/;

export function validateResult(raw: unknown): { ok: true; result: ActionResult } | { ok: false; reason: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'result must be an object' };
  const r = raw as Record<string, unknown>;
  const unknown = Object.keys(r).find((k) => !(RESULT_KEYS as string[]).includes(k));
  if (unknown !== undefined) return { ok: false, reason: `unknown result key ${unknown}` };
  if (r.status !== 'done' && r.status !== 'cancelled' && r.status !== 'failed') return { ok: false, reason: 'status must be done, cancelled or failed' };
  if (r.code !== undefined && (typeof r.code !== 'string' || !RESULT_CODE.test(r.code))) return { ok: false, reason: 'code must be lowercase letters, digits and underscores' };
  if (r.message !== undefined && (typeof r.message !== 'string' || r.message.length > MAX_RESULT_MESSAGE_CHARS || r.message.includes('\0'))) {
    return { ok: false, reason: `message must be text of at most ${MAX_RESULT_MESSAGE_CHARS} characters` };
  }
  return { ok: true, result: r as unknown as ActionResult };
}
