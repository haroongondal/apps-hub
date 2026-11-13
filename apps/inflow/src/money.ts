const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Digit strings, not division: the decimals stay exact for any safe integer.
export function formatAmount(minor: number, currency: string): string {
  const digits = String(Math.abs(minor)).padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+$)/g, ',');
  return `${minor < 0 ? '-' : ''}${currency} ${whole}.${digits.slice(-2)}`;
}

// Local time. `to` is the first instant of the next month, so ranges are [from, to).
export function monthRange(year: number, month: number): { from: number; to: number } {
  return { from: new Date(year, month, 1).getTime(), to: new Date(year, month + 1, 1).getTime() };
}

export const monthLabel = (year: number, month: number): string => `${MONTHS[month]} ${year}`;

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}
