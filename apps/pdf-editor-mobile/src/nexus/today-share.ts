import { File, Paths } from 'expo-file-system';
import { AppState } from 'react-native';

import { metaFlags, TODAY_KEY } from './meta-flags';
import { closedFile, createHeartbeat } from './share-files';
import { buildTodaySnapshot, todayWindow } from './today';
import { onQueueChange, openKnowledge } from './worker';

// Paths.document is the app's filesDir, where ai_source goes and where the provider in nexus-links reads today.json and last_seen.
// A temp file moved into place, so a reader sees the old file, nothing, or the new one, never half of one.
function writeAtomic(name: string, text: string): void {
  const tmp = new File(Paths.document, `${name}.tmp`);
  const target = new File(Paths.document, name);
  if (tmp.exists) tmp.delete();
  tmp.write(text);
  if (target.exists) target.delete(); // File.move doesn't document overwriting
  tmp.move(target);
}

const today = closedFile({
  write: (text) => writeAtomic('today.json', text),
  remove: () => {
    const target = new File(Paths.document, 'today.json');
    if (target.exists) target.delete();
  },
});
const heartbeat = createHeartbeat({ now: Date.now, write: (text) => writeAtomic('last_seen', text) });
let turn: Promise<void> = Promise.resolve();

/** Rewrites files/today.json from the due dates and the switch. Call it when either changes. Never throws. */
export function refreshTodayShare(): Promise<void> {
  const step = async () => {
    try {
      const kn = await openKnowledge();
      const on = await metaFlags(kn.lib.db).get(TODAY_KEY);
      const now = Date.now();
      const rows = on ? await kn.lib.dueBetween(...todayWindow(now)) : [];
      today.put(buildTodaySnapshot(rows, on, now));
    } catch (err) {
      console.warn('Nexus could not update what is due today for other apps', err);
    }
  };
  return (turn = turn.then(step, step));
}

export async function todayShareOn(): Promise<boolean> {
  return metaFlags((await openKnowledge()).lib.db).get(TODAY_KEY);
}

/** Off removes today.json before anything else; if that fails it throws, so the switch never reads Off while the file still serves. */
export async function setTodayShare(on: boolean): Promise<void> {
  if (!on) today.clear();
  await metaFlags((await openKnowledge()).lib.db).set(TODAY_KEY, on);
  await refreshTodayShare();
}

export const beatHeartbeat = (): boolean => heartbeat.beat();

/** On app start, on coming back to the foreground and after each worker step (the heartbeat is throttled to once a minute). */
export function startShares(): () => void {
  const open = () => {
    beatHeartbeat();
    void refreshTodayShare();
  };
  open();
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') open();
  });
  const off = onQueueChange(beatHeartbeat);
  return () => {
    sub.remove();
    off();
  };
}
