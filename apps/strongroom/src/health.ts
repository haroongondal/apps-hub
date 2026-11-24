import type { HealthFlag, HealthReport, Row } from 'strongroom-vault';
import { plural } from './forms.ts';

type Weakness = Exclude<HealthFlag, 'common' | 'reused'>;

export const REASONS: Record<Weakness, string> = {
  short: 'Short',
  digits: 'Only numbers',
  run: 'A keyboard or alphabet run, like qwerty or abcd',
  repeats: 'The same characters over and over',
  name: 'Has the site name or your username in it',
};

export interface CheckRow {
  id: string;
  title: string;
  subtitle: string;
}

export interface CheckSection {
  key: string;
  title: string;
  footer?: string;
  rows: CheckRow[];
}

const passwords = (n: number) => plural(n, 'password', 'passwords');

export function summary(r: HealthReport): string {
  if (r.checked === 0) return 'You have no saved passwords to check yet.';
  const parts = [
    r.reused > 0 && `${r.reused} used on more than one login`,
    r.weak > 0 && `${r.weak} easy to guess`,
    r.common > 0 && `${r.common} well known`,
  ].filter((p): p is string => typeof p === 'string');
  if (parts.length === 0) return `Checked ${passwords(r.checked)}. Nothing needs changing.`;
  return `Checked ${passwords(r.checked)}: ${parts.join(', ')}.`;
}

// Rows follow the vault list's order; an entry deleted since the check is left out.
export function sections(r: HealthReport, rows: Row[]): CheckSection[] {
  const order = new Map(rows.map((row, i) => [row.id, i]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const known = r.items.filter((it) => byId.has(it.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const line = (id: string, subtitle?: string): CheckRow => {
    const row = byId.get(id)!;
    return { id, title: row.name || 'Untitled', subtitle: subtitle ?? row.subtitle };
  };

  const groups = [...new Set(known.filter((it) => it.group > 0).map((it) => it.group))].sort((a, b) => a - b);
  const reused = groups.map((g, i): CheckSection => {
    const ids = known.filter((it) => it.group === g).map((it) => it.id);
    return {
      key: `group-${g}`,
      title: `Same password on ${plural(ids.length, 'login', 'logins')}`,
      footer: i === groups.length - 1 ? 'Give each login its own password, so one leaked password opens only one account.' : undefined,
      rows: ids.map((id) => line(id)),
    };
  });

  const weak = known
    .map((it) => ({ id: it.id, reasons: it.flags.filter((f): f is Weakness => f in REASONS).map((f) => REASONS[f]) }))
    .filter((w) => w.reasons.length > 0);
  const common = known.filter((it) => it.flags.includes('common'));

  return [
    ...reused,
    weak.length > 0 && {
      key: 'weak',
      title: 'Easy to guess',
      footer: 'A longer password that mixes letters, numbers and symbols is much harder to guess.',
      rows: weak.map((w) => line(w.id, w.reasons.join(' · '))),
    },
    common.length > 0 && {
      key: 'common',
      title: 'Well-known passwords',
      footer: 'These are on public lists of the passwords people use most.',
      rows: common.map((it) => line(it.id)),
    },
  ].filter((s): s is CheckSection => typeof s === 'object');
}
