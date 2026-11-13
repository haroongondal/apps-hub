const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const two = (n: number): string => (n < 10 ? `0${n}` : String(n));

// Local time, on the phone's clock: "12:02" today, "Yesterday", "12 Nov" this year, "12 Nov 2025" before that.
export function whenLabel(at: number, now: number): string {
  const d = new Date(at);
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) return `${two(d.getHours())}:${two(d.getMinutes())}`;
  const y = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) return 'Yesterday';
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === n.getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

export function keepLabel(days: number | null): string {
  if (days === null) return 'Forever';
  if (days === 365) return '1 year';
  return `${days} days`;
}
