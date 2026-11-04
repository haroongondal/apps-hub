import { formatMb, type JobState } from '@apps-hub/media-core';
import type { NativeJobStatus } from 'design-media';

import { planTitle } from './tools.ts';

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

// One plain line per job: what it is doing, or what happened and what to do (PRD FR-13).
export function jobText(job: Pick<NativeJobStatus, 'state' | 'tool' | 'progress' | 'attempt' | 'outputs' | 'error'>): { line: string; tone: Tone; label: string } {
  const what = planTitle(job.tool);
  const labels: Record<JobState, [string, Tone]> = {
    queued: ['Waiting', 'neutral'], running: ['Working', 'accent'], done: ['Done', 'ok'], failed: ['Failed', 'danger'],
    cancelled: ['Stopped', 'neutral'], interrupted: ['Interrupted', 'warn'], paused: ['Paused', 'warn'],
  };
  const [label, tone] = labels[job.state];
  switch (job.state) {
    case 'running': return { label, tone, line: `${what} · ${Math.round(job.progress * 100)}%${job.attempt > 1 ? ' · Trying a smaller size' : ''}` };
    case 'queued': return { label, tone, line: `${what} · Waiting its turn` };
    case 'done': return { label, tone, line: `${what} · Saved${job.outputs[0] ? ` ${formatMb(job.outputs[0].bytes)}` : ''}` };
    case 'failed': return { label, tone, line: `${what} · ${job.error ?? 'Something went wrong. Try again.'}` };
    case 'paused': return { label, tone, line: `${what} · Android paused this after a long run. Tap Resume to carry on.` };
    case 'interrupted': return { label, tone, line: `${what} · The app closed while this was running. Tap Resume to start it again.` };
    default: return { label, tone, line: `${what} · Stopped` };
  }
}
