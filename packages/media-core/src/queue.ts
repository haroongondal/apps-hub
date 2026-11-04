import type { Job, QueueEvent } from './types.ts';

// Pure job state machine (SPEC §8). Returns new objects; the input array is not changed.
export function reduce(jobs: Job[], e: QueueEvent): Job[] {
  switch (e.type) {
    case 'enqueue': return [...jobs, ...e.jobs];
    case 'start': return update(jobs, e.id, j => ({ ...j, state: 'running', attempt: 1, progress: 0, startedAt: e.at }));
    case 'progress': return update(jobs, e.id, j => (j.state === 'running' ? { ...j, progress: e.fraction } : j));
    case 'retry': return update(jobs, e.id, j => ({ ...j, plan: e.plan, attempt: j.attempt + 1, progress: 0 }));
    case 'done': return update(jobs, e.id, j => ({ ...j, state: 'done', outputs: e.outputs, progress: 1, finishedAt: e.at }));
    case 'fail': return update(jobs, e.id, j => ({ ...j, state: 'failed', error: e.error, finishedAt: e.at }));
    case 'cancel': return jobs.map(j => (e.id === 'all' || j.id === e.id) && (j.state === 'queued' || j.state === 'running')
      ? { ...j, state: 'cancelled' } : j);
    case 'interrupt': return jobs.map(j => (j.state === 'running' ? { ...j, state: 'interrupted' } : j));
    case 'pause': return jobs.map(j => (j.state === 'running' ? { ...j, state: 'paused' } : j));
    case 'resume': return jobs.map(j => (j.state === 'paused' || j.state === 'interrupted'
      ? { ...j, state: 'queued', error: undefined } : j));
  }
}

// One job at a time: nothing starts while a job is running. Jobs run in queue order.
export function nextRunnable(jobs: Job[]): Job | undefined {
  if (jobs.some(j => j.state === 'running')) return undefined;
  return jobs.find(j => j.state === 'queued');
}

function update(jobs: Job[], id: string, f: (j: Job) => Job): Job[] {
  return jobs.map(j => (j.id === id ? f(j) : j));
}

// The Queue screen shows at most `limit` jobs: running first, then waiting, then the newest finished or failed
// (PRD FR-9, AC-15). `hidden` is how many more the "See all" screen holds. Stopped jobs (paused, interrupted)
// sit with the waiting ones because the person can resume them.
export function visibleQueue<T extends Pick<Job, 'state' | 'finishedAt'>>(jobs: T[], limit = 5): { shown: T[]; hidden: number } {
  const rank = (j: T) => j.state === 'running' ? 0 : j.state === 'queued' || j.state === 'paused' || j.state === 'interrupted' ? 1 : 2;
  const ordered = jobs
    .map((job, i) => ({ job, i, rank: rank(job) }))
    .sort((a, b) => a.rank - b.rank || (a.rank === 2 ? (b.job.finishedAt ?? 0) - (a.job.finishedAt ?? 0) || b.i - a.i : a.i - b.i))
    .map(x => x.job);
  return { shown: ordered.slice(0, limit), hidden: Math.max(0, ordered.length - limit) };
}
