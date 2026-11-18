import type { Job } from '@apps-hub/knowledge-core';
import type { ItemKind } from '@apps-hub/library-core';
import type { Tone } from '@apps-hub/ui';

const MAX_TITLE = 80;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function noteTitle(text: string): string {
  const line = text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
  const chars = Array.from(line.replace(/^#+\s*/, '').replace(/[\x00-\x1f\x7f-\x9f]/g, ''));
  if (chars.length === 0) return 'Untitled note';
  return chars.length > MAX_TITLE ? `${chars.slice(0, MAX_TITLE - 1).join('').trimEnd()}…` : chars.join('');
}

export function captureTitle(kind: 'audio' | 'image', at: Date): string {
  const time = `${at.getDate()} ${MONTHS[at.getMonth()]} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return `${kind === 'audio' ? 'Voice note' : 'Photo'}, ${time}`;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

const WORKING: Record<Exclude<Job['stage'], 'done'>, (kind: ItemKind) => string> = {
  text: (kind) => (kind === 'audio' ? 'Transcribing' : kind === 'image' ? 'Reading the image' : 'Reading'),
  embed: () => 'Indexing',
  graph: () => 'Finding ideas',
};

export function jobLabel(job: Job | null, kind: ItemKind, hasKey: boolean, found: { ideas: number; links: number }): { label: string; tone: Tone } {
  if (!job) return { label: 'Not processed yet', tone: 'neutral' };
  if (job.status === 'done') return { label: `${plural(found.ideas, 'idea')}, ${plural(found.links, 'link')}`, tone: 'ok' };
  if (job.status === 'failed') return { label: `Couldn't process it: ${job.error ?? 'unknown error'}`, tone: 'danger' };
  if (!hasKey) return { label: 'Waiting for an AI key', tone: 'warn' };
  if (job.status === 'queued' && job.error) return { label: job.error, tone: 'warn' };
  return { label: `${WORKING[job.stage as Exclude<Job['stage'], 'done'>](kind)}…`, tone: 'accent' };
}
