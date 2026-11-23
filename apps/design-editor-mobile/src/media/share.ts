import DesignMedia from 'design-media';
import { router, useRootNavigationState } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect } from 'react';

import { plainError } from './errors';
import { listInbox, receiveShare, type IntakeDeps, type Received } from './share-intake.ts';

const intake: IntakeDeps = {
  take: () => DesignMedia.takeShare(),
  move: (from, to) => FileSystem.moveAsync({ from, to }),
  remove: uri => FileSystem.deleteAsync(uri, { idempotent: true }),
};

let queued: Promise<unknown> = Promise.resolve();

// Two shares close together are taken one after the other, so their copies never mix.
export function receiveSharedFiles(): Promise<Received> {
  const run = queued.then(() => receiveShare(intake));
  queued = run.catch(() => undefined);
  return run;
}

export const readInbox = () => listInbox({
  root: `${FileSystem.documentDirectory}shared/`,
  readDir: uri => FileSystem.readDirectoryAsync(uri),
  sizeOf: async uri => { const info = await FileSystem.getInfoAsync(uri); return info.exists ? info.size : 0; },
});

export const removeFromInbox = (uris: string[]) => Promise.all(uris.map(uri => intake.remove(uri).catch(() => undefined)));

// A share that opened the app, or arrived while it was open, ends on the Add to Design Editor screen.
// Nothing is queued from here; the person chooses on that screen.
export function useShareIntake() {
  const ready = !!useRootNavigationState()?.key;
  useEffect(() => {
    if (!ready) return;
    const show = (notes: string[]) => router.navigate({ pathname: '/share', params: { notes: notes.join('\n'), at: String(Date.now()) } });
    const run = () => receiveSharedFiles().then(
      got => { if (got.items.length || got.notes.length) show(got.notes); },
      e => show([plainError(e, "Something went wrong adding what you shared. Share it again.")]),
    );
    void run();
    const subscription = DesignMedia.addListener('onShare', run);
    return () => subscription.remove();
  }, [ready]);
}
