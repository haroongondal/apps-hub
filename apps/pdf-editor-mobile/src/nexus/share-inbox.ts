import type { Item } from '@apps-hub/library-core';
import { Directory, File, Paths } from 'expo-file-system';

import { addPdf } from '../library/files';
import { entryName } from '../library/paths';

import { addNote, addSharedAudio, addSharedPhoto } from './capture';
import { isInboxId, onlyExisting, parseInbox, staleInboxes, type IntakeDeps, type SharedPayload } from './share-intake';

// ShareActivity (modules/audio-chunks) writes here: Paths.document is the app's filesDir. Nothing indexes this folder.
const inboxRoot = () => new Directory(Paths.document, 'shared-inbox');

function inboxDir(id: string): Directory {
  if (!isInboxId(id)) throw new Error('That share is not one Nexus received.');
  return new Directory(inboxRoot(), id);
}

export async function readInbox(id: string): Promise<SharedPayload | null> {
  const manifest = new File(inboxDir(id), 'inbox.json');
  if (!manifest.exists) return null;
  const payload = parseInbox(await manifest.text());
  return payload && onlyExisting(payload, (name) => inboxFile(id, name).exists);
}

export function inboxFile(id: string, name: string): File {
  return new File(inboxDir(id), name);
}

export function discardInbox(id: string): void {
  const dir = inboxDir(id);
  if (dir.exists) dir.delete();
}

export function sweepInboxes(now = Date.now()): void {
  const root = inboxRoot();
  if (!root.exists) return;
  const entries = root.list();
  const stale = new Set(staleInboxes(entries.map(entryName), now));
  for (const entry of entries) if (stale.has(entryName(entry))) entry.delete();
}

export const inboxDeps = (id: string): IntakeDeps<Item> => ({
  addPdf: (file, title) => addPdf(inboxFile(id, file).uri, null, title),
  addImage: (file, title) => addSharedPhoto(inboxFile(id, file), title),
  addAudio: (file, ext, title) => addSharedAudio(inboxFile(id, file), ext, title),
  addNote: (text) => addNote(text),
  discard: () => discardInbox(id),
});
