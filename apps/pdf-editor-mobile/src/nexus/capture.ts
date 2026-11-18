import type { Item } from '@apps-hub/library-core';
import { File } from 'expo-file-system';

import { dirSize } from '../library/files';
import { newId } from '../library/ids';
import { openLibrary } from '../library/open-library';
import { itemDir, itemFile } from '../library/paths';

import { captureTitle, noteTitle } from './labels';
import { enqueue } from './worker';

// Files first, row second: a crash in between leaves a directory the start-up sweep removes.
async function addItem(kind: Item['kind'], title: string, write: (id: string) => void, body?: string, saved?: () => void): Promise<Item> {
  const lib = await openLibrary();
  const id = newId();
  const dir = itemDir(id);
  dir.create({ intermediates: true });
  let item: Item;
  try {
    write(id);
    item = await lib.createItem({ id, kind, title, sizeBytes: dirSize(id), body });
  } catch (error) {
    dir.delete();
    throw error;
  }
  saved?.();
  enqueue(id).catch((err) => console.warn('Could not queue it for AI', err));
  return item;
}

export const addNote = (text: string) =>
  addItem('note', noteTitle(text), (id) => itemFile(id, 'note.md').write(text), text);

export const addRecording = (uri: string) =>
  addItem(
    'audio',
    captureTitle('audio', new Date()),
    (id) => new File(uri).copy(itemFile(id, 'audio.m4a')),
    undefined,
    () => new File(uri).delete(), // the recorder's file is the only copy until the row exists
  );

export const addPhoto = (uri: string) =>
  addItem('image', captureTitle('image', new Date()), (id) => new File(uri).copy(itemFile(id, 'image.jpg')));

export async function saveNote(item: Item, text: string): Promise<void> {
  const lib = await openLibrary();
  itemFile(item.id, 'note.md').write(text);
  await lib.setBody(item.id, text);
  await lib.updateItem(item.id, { title: noteTitle(text), sizeBytes: dirSize(item.id) });
}
