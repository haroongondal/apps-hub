import { AiError, type Job, type MinutesAction, type MinutesPoint } from '@apps-hub/knowledge-core';
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

const CAPTURED = { audio: 'Voice note', image: 'Photo', meeting: 'Meeting' };

export function captureTitle(kind: keyof typeof CAPTURED, at: Date): string {
  const time = `${at.getDate()} ${MONTHS[at.getMonth()]} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return `${CAPTURED[kind]}, ${time}`;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

const WORKING: Record<Exclude<Job['stage'], 'done'>, (kind: ItemKind) => string> = {
  text: (kind) => (kind === 'audio' ? 'Transcribing' : kind === 'image' ? 'Reading the image' : 'Reading'),
  embed: () => 'Indexing',
  graph: () => 'Finding ideas',
};

export function jobLabel(
  job: Job | null,
  kind: ItemKind,
  hasKey: boolean,
  found: { ideas: number; links: number },
  keptOut = false,
): { label: string; tone: Tone } {
  if (keptOut) return { label: 'Not in Nexus', tone: 'neutral' };
  if (!job) return { label: 'Not processed yet', tone: 'neutral' };
  if (job.status === 'done') return { label: `${plural(found.ideas, 'idea')}, ${plural(found.links, 'link')}`, tone: 'ok' };
  if (job.status === 'failed') return { label: `Couldn't process it: ${job.error ?? 'unknown error'}`, tone: 'danger' };
  if (!hasKey) return { label: 'Waiting for an AI key', tone: 'warn' };
  if (job.status === 'queued' && job.error) return { label: job.error, tone: 'warn' };
  return { label: `${WORKING[job.stage as Exclude<Job['stage'], 'done'>](kind)}…`, tone: 'accent' };
}

const two = (n: number) => String(n).padStart(2, '0');

export function clockTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

export function minutesDetail(p: MinutesPoint & Partial<Pick<MinutesAction, 'owner' | 'due'>>): string {
  return [p.owner, p.due, p.cites.map((c) => clockTime(c.startSec)).join(', ')].filter(Boolean).join(' · ');
}

export const seekTo = (p: MinutesPoint): number => p.cites[0].startSec;

// The queue's own messages promise a later retry; minutes run only on a tap, so they say what to do instead.
export function minutesError(err: unknown): string {
  if (err instanceof AiError && err.kind === 'rate') return 'The AI service is busy for your key. Wait a minute, then try again.';
  if (err instanceof AiError && err.kind === 'offline') return "Nexus couldn't reach the AI service. Check your connection, then try again.";
  return err instanceof Error ? err.message : String(err);
}
