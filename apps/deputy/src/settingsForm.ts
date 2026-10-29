import type { Settings } from 'deputy-agent';

const NUMBERS = ['inputPerM', 'cachedPerM', 'outputPerM', 'maxSteps', 'maxCostUsd', 'maxMinutes', 'dailyCostUsd'] as const;
type NumberKey = (typeof NUMBERS)[number];

export type SettingsForm = Omit<Settings, NumberKey> & Record<NumberKey, string>;

const mapNumbers = <T, U>(o: Record<NumberKey, T>, f: (v: T) => U) => Object.fromEntries(NUMBERS.map((k) => [k, f(o[k])])) as Record<NumberKey, U>;

// Number('') is 0: a cleared field must reach the native check as invalid instead.
const parse = (t: string): number => (t.trim() === '' ? NaN : Number(t.trim().replace(',', '.')));

export const toForm = (s: Settings): SettingsForm => ({ ...s, ...mapNumbers(s, String) });

export const fromForm = (f: SettingsForm): Settings => ({ ...f, ...mapNumbers(f, parse) });
