import { ITEM_ID } from '@apps-hub/library-core';

/** What is kept beside a meeting's audio file: when it started, and the item id once saving has begun. */
export interface MeetingSession {
  startedAt: number;
  itemId: string | null;
}

export type MeetingState = 'none' | 'recording' | 'unsaved' | 'saved' | 'empty';

export const sessionText = (s: MeetingSession) => JSON.stringify({ v: 1, startedAt: s.startedAt, itemId: s.itemId });

export function parseSession(text: string): MeetingSession | null {
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== 'object' || v === null) return null;
    const { v: version, startedAt, itemId } = v as Record<string, unknown>;
    if (version !== 1 || typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
    if (itemId !== null && !(typeof itemId === 'string' && ITEM_ID.test(itemId))) return null;
    return { startedAt, itemId };
  } catch {
    return null;
  }
}

// Nothing is saved without the user: a recording with sound in it is offered until they save or delete it.
export function meetingState(at: { recording: boolean; session: MeetingSession | null; audioBytes: number; itemSaved: boolean }): MeetingState {
  if (at.recording) return 'recording';
  if (at.session?.itemId && at.itemSaved) return 'saved';
  if (at.audioBytes > 0) return 'unsaved';
  return at.session ? 'empty' : 'none';
}

export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const [h, m, s] = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}
