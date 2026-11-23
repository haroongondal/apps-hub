import { PROPOSE_TASK, validateExtras } from '@apps-hub/app-link-contract';

export type DeputyOutcome = 'handed_over' | 'cancelled' | 'not_installed' | 'refused' | 'busy';
export type NexusOutcome = 'sent' | 'not_installed';

export const DEPUTY_APPS = [
  { key: '', label: 'Any app' },
  { key: 'com.whatsapp', label: 'WhatsApp' },
  { key: 'com.instagram.android', label: 'Instagram' },
  { key: 'org.telegram.messenger', label: 'Telegram' },
  { key: 'com.facebook.katana', label: 'Facebook' },
] as const;

export const TARGET_MAX = 120;
export const NEXUS_MAX_PHOTOS = 10;
const TASK_MAX = PROPOSE_TASK.extras.task.max;
const ELLIPSIS = '…';

const tidy = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();

// Cuts whole characters (code points), so an emoji is never split into half a surrogate pair.
function fit(text: string, room: number): string {
  if (text.length <= room) return text;
  const chars = Array.from(text);
  while (chars.length && chars.join('').length + ELLIPSIS.length > room) chars.pop();
  return chars.join('').trimEnd() + ELLIPSIS;
}

export type DeputyDraft = { ok: true; extras: { task: string; apps?: string[] } } | { ok: false; reason: string };

// The task is only ever the owner's own typed words in Design Editor's sentence; the caption is shortened before the target ever is.
export function deputyDraft(target: string, caption: string, app: string): DeputyDraft {
  const who = tidy(target);
  if (!who) return { ok: false, reason: 'Type who to send it to, like the Family group on WhatsApp.' };
  if (who.length > TARGET_MAX) return { ok: false, reason: `Keep who to send it to under ${TARGET_MAX} letters.` };
  const head = `Send the newest video from the Design Editor folder in Movies to ${who}.`;
  const words = tidy(caption);
  const task = words ? `${head} Caption: ${fit(words, TASK_MAX - head.length - ' Caption: '.length)}` : head;
  const extras = app ? { task, apps: [app] } : { task };
  const check = validateExtras(PROPOSE_TASK, extras);
  return check.ok ? { ok: true, extras } : { ok: false, reason: 'That text cannot go to Deputy. Change it and try again.' };
}

export const DEPUTY_TEXT: Record<DeputyOutcome, { tone: 'ok' | 'warn' | 'danger'; text: string }> = {
  handed_over: { tone: 'ok', text: 'Deputy has your draft. Check it there and tap Start. Deputy asks you again before it sends anything.' },
  cancelled: { tone: 'warn', text: 'You closed the draft in Deputy. Nothing was sent.' },
  not_installed: { tone: 'danger', text: 'Deputy is not on this phone. Install it from the Store, then try again.' },
  refused: { tone: 'danger', text: 'Deputy did not take the draft. Install both apps from the Store, then try again.' },
  busy: { tone: 'warn', text: 'Deputy already has a draft open from here. Finish that one first.' },
};

export function nexusProblem(count: number): string | null {
  if (count < 1) return 'Choose at least one photo.';
  if (count > NEXUS_MAX_PHOTOS) return `Nexus takes up to ${NEXUS_MAX_PHOTOS} photos at a time. Leave some out, then try again.`;
  return null;
}

export const NEXUS_TEXT: Record<NexusOutcome, string> = {
  sent: 'Nexus is open. Check the photos there and tap Add to keep them.',
  not_installed: 'Nexus is not on this phone. Install it from the Store, then try again.',
};
