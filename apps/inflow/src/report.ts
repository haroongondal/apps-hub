import type { ReportRow } from 'inflow-core';
import { monthLabel } from './money.ts';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 0..1; 0 when there is no maximum to scale against.
export function barFraction(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.min(1, value / max);
}

// `change` is a percent against the last report, null when there was nothing to compare.
export function changeLabel(change: number | null): string | null {
  if (change === null) return null;
  if (Math.abs(change) < 0.5) return 'Same as before';
  return `${change > 0 ? 'Up' : 'Down'} ${Math.round(Math.abs(change))}%`;
}

// A week is named by its Monday to Sunday dates. The period starts Sunday 21:00, so 12 hours on lands on the Monday; a "so far" report still names the whole week.
function weekLabel(periodStart: number): string {
  const probe = new Date(periodStart + 12 * 3600_000);
  const mon = new Date(probe.getFullYear(), probe.getMonth(), probe.getDate() - ((probe.getDay() + 6) % 7));
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  const from = mon.getMonth() === sun.getMonth() ? `${mon.getDate()}` : `${mon.getDate()} ${SHORT[mon.getMonth()]} `;
  const dash = mon.getMonth() === sun.getMonth() ? '–' : '– ';
  return `Week of ${from}${dash}${sun.getDate()} ${SHORT[sun.getMonth()]}`;
}

export function reportTitle(row: Pick<ReportRow, 'kind' | 'periodStart' | 'partial'>): string {
  const d = new Date(row.periodStart);
  const title = row.kind === 'monthly' ? monthLabel(d.getFullYear(), d.getMonth()) : weekLabel(row.periodStart);
  return row.partial ? `${title} (so far)` : title;
}
