import type { Project } from '@apps-hub/media-core';
import DesignMedia from 'design-media';
import * as FileSystem from 'expo-file-system/legacy';

import { restoreDraft } from './draft';

export const draftPath = () => `${FileSystem.documentDirectory}video-project.json`;

export const saveDraft = (p: Project) => FileSystem.writeAsStringAsync(draftPath(), JSON.stringify(p));

export const canOpen = (uri: string) => DesignMedia.probe(uri).then(() => true, () => false);

export async function loadDraft(readable: (uri: string) => Promise<boolean> = canOpen) {
  const text = await FileSystem.readAsStringAsync(draftPath()).catch(() => undefined);
  return restoreDraft(text, readable);
}
