import { useEffect } from 'react';
import { AppState, PermissionsAndroid } from 'react-native';
import InflowCore, { addCapturedListener } from 'inflow-core';
import TextOcr, { allText } from 'text-ocr';
import { runAutoReceipts } from './autoReceipts.ts';

// The screenshot is taken a little after the bank's text arrives.
const SETTLE_MS = 20_000;
const cache = new Map<string, string>();

/** While unlocked: on open, on coming back to the app and after each new message, find the screenshot of any recent payment that has none. */
export function useAutoReceipts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let running = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const active = () => alive && AppState.currentState === 'active';
    const run = async () => {
      if (!active()) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        // Never asks: the Find receipt row does that, and a silent dialog here would be a surprise.
        if (!(await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES))) return;
        await runAutoReceipts(
          {
            now: Date.now,
            recentOut: () => InflowCore.listTxns(null, null, 40, null).filter((t) => t.direction === 'out'),
            hasReceipt: (t) => t.itemIds.some((id) => InflowCore.mediaFor(id).some((m) => m.kind === 'image')),
            photos: InflowCore.galleryBetween,
            read: async (uri) => allText((await TextOcr.recognizeFile(uri)).lines),
            attach: InflowCore.attachReceipt,
          },
          cache,
          active,
        );
      } catch {
        // Nothing to report: the Find receipt row works by hand and says what went wrong.
      } finally {
        running = false;
        if (again) {
          again = false;
          void run();
        }
      }
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), SETTLE_MS);
    };
    void run();
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') void run();
    });
    const captured = addCapturedListener(later);
    return () => {
      alive = false;
      clearTimeout(timer);
      app.remove();
      captured.remove();
    };
  }, [enabled]);
}
