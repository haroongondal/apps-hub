import type { Project } from '@apps-hub/media-core';
import DesignMedia from 'design-media';
import * as FileSystem from 'expo-file-system/legacy';

import { isBlank, queued, restoreDraft } from './draft';

export const draftPath = () => `${FileSystem.documentDirectory}video-project.json`;

// Saves and discards run one at a time in the order asked, so a late save cannot bring back a draft that
// was just discarded. A save is written beside the draft, then renamed over it (an atomic rename on
// Android), so a kill mid-write leaves the last good draft instead of an empty project.
const serial = queued(async (job: () => Promise<void>) => job());

const write = async (p: Project) => {
  const part = `${draftPath()}.part`;
  await FileSystem.writeAsStringAsync(part, JSON.stringify(p));
  await FileSystem.moveAsync({ from: part, to: draftPath() });
};

const remove = async () => {
  await FileSystem.deleteAsync(`${draftPath()}.part`, { idempotent: true });
  await FileSystem.deleteAsync(draftPath(), { idempotent: true });
};

export const saveDraft = (p: Project) => serial(() => (isBlank(p) ? remove() : write(p)));

// Forgets the project on the phone. The video files it used are not touched.
export const discardDraft = () => serial(remove);

export const canOpen = (uri: string) => DesignMedia.probe(uri).then(() => true, () => false);

export async function loadDraft(readable: (uri: string) => Promise<boolean> = canOpen) {
  const text = await FileSystem.readAsStringAsync(draftPath()).catch(() => undefined);
  return restoreDraft(text, readable);
}
