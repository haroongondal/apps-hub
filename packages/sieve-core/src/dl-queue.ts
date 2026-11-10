import type { DlRecord } from './dl-record.ts';
import type { QueueSetting, Schedule } from './dl-settings.ts';

export interface Plan { start: string[]; stop: string[] }   // record ids

export function minutesOf(hhmm: string): number {   // '22:30' is 1350
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

// Local time. Daylight-saving days shift a window by an hour (known limit, not handled).
export function isOpen(s: Schedule, at: Date): boolean {
  if (!s.on) return true;
  const now = at.getHours() * 60 + at.getMinutes();
  const start = minutesOf(s.start);
  const day = at.getDay();
  const listed = (d: number) => s.days.includes(d);
  if (s.stop === null) return listed(day) && now >= start;
  const stop = minutesOf(s.stop);
  if (stop > start) return listed(day) && now >= start && now < stop;
  return (listed(day) && now >= start) || (listed((day + 6) % 7) && now < stop);
}

// epoch ms of the next flip between open and closed; null when the schedule is off or never flips
export function nextChange(s: Schedule, at: Date): number | null {
  if (!s.on) return null;
  const start = minutesOf(s.start);
  const stop = s.stop === null ? null : minutesOf(s.stop);
  const at0 = at.getTime();
  const edges: number[] = [];
  // 9 days from yesterday, so a window that began yesterday still shows its stop
  for (let off = -1; off <= 7; off++) {
    const d = new Date(at.getFullYear(), at.getMonth(), at.getDate() + off);
    if (!s.days.includes(d.getDay())) continue;
    const at_ = (dayOff: number, min: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOff, 0, min).getTime();
    edges.push(at_(0, start));
    if (stop === null) edges.push(at_(1, 0));
    else edges.push(at_(stop > start ? 0 : 1, stop));
  }
  const was = isOpen(s, at);
  return edges.sort((a, b) => a - b).find((t) => t > at0 && isOpen(s, new Date(t)) !== was) ?? null;
}

// the earliest nextChange over queues whose schedule is on
export function nextWake(queues: readonly QueueSetting[], at: Date): number | null {
  let best: number | null = null;
  for (const q of queues) {
    const t = nextChange(q.schedule, at);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

// the queue with that id, else the first
export function queueOf(queues: readonly QueueSetting[], id: string): QueueSetting {
  return queues.find((q) => q.id === id) ?? queues[0];
}

const byAge = (a: DlRecord, b: DlRecord) => a.addedAt - b.addedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function schedulePlan(records: readonly DlRecord[], queues: readonly QueueSetting[], at: Date, on: boolean): Plan {
  const plan: Plan = { start: [], stop: [] };
  const own = new Map<string, DlRecord[]>(queues.map((q) => [q.id, []]));
  for (const r of records) {
    if (r.state !== 'queued' && r.state !== 'running') continue;
    own.get(queueOf(queues, r.queue).id)!.push(r);
  }
  for (const q of queues) {
    const mine = own.get(q.id)!.sort(byAge);
    const open = on && isOpen(q.schedule, at);
    const stop = mine.filter((r) => r.state === 'running' && !r.force && !open);
    const forced = mine.filter((r) => r.state === 'queued' && r.force);
    const running = mine.filter((r) => r.state === 'running' && !stop.includes(r)).length + forced.length;
    const slots = open ? Math.max(0, q.maxParallel - running) : 0;
    const more = mine.filter((r) => r.state === 'queued' && !r.force).slice(0, slots);
    plan.stop.push(...stop.map((r) => r.id));
    plan.start.push(...[...forced, ...more].sort(byAge).map((r) => r.id));
  }
  return plan;
}
