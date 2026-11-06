import type { Project } from '@apps-hub/media-core';
import DesignMedia from 'design-media';
import * as FileSystem from 'expo-file-system/legacy';

import { queued, restoreDraft } from './draft';

export const draftPath = () => `${FileSystem.documentDirectory}video-project.json`;

// Written beside the draft, then renamed over it (an atomic rename on Android), one save at a time,
// so a kill mid-write leaves the last good draft instead of an empty project.
export const saveDraft = queued(async (p: Project) => {
  const part = `${draftPath()}.part`;
  await FileSystem.writeAsStringAsync(part, JSON.stringify(p));
  await FileSystem.moveAsync({ from: part, to: draftPath() });
});

export const canOpen = (uri: string) => DesignMedia.probe(uri).then(() => true, () => false);

export async function loadDraft(readable: (uri: string) => Promise<boolean> = canOpen) {
  const text = await FileSystem.readAsStringAsync(draftPath()).catch(() => undefined);
  return restoreDraft(text, readable);
}
