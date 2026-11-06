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
