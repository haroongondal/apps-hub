import type { Item } from '@apps-hub/library-core';
import { AudioChunks } from 'audio-chunks';
import { File } from 'expo-file-system';
import { PdfScan } from 'pdf-scan';

import { dirSize } from '../library/files';
import { newId } from '../library/ids';
import { openLibrary } from '../library/open-library';
import { itemDir, itemFile } from '../library/paths';

import { captureTitle, noteTitle } from './labels';
import type { AudioExt } from './share-intake';
import { enqueue } from './worker';

// Files first, row second: a crash in between leaves a directory the start-up sweep removes.
async function addItem(
  kind: Item['kind'],
  title: string,
  write: (id: string) => void | Promise<void>,
  body?: string,
  saved?: () => void,
  id = newId(),
): Promise<Item> {
  const lib = await openLibrary();
  const dir = itemDir(id);
  dir.create({ intermediates: true });
  let item: Item;
  try {
    await write(id);
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

const WHOLE_MS = 7 * 24 * 3_600_000; // past any meeting's end, so the cut copies all of it without asking ADTS for its length

/** The meeting's ADTS recording becomes a normal voice note's `audio.m4a` (same samples, MPEG-4 box), so playing, seeking and transcribing work unchanged. */
export const addMeeting = (recordingUri: string, id: string, startedAt: Date, saved: () => void) =>
  addItem(
    'audio',
    captureTitle('meeting', startedAt),
    async (itemId) => {
      if (!AudioChunks) throw new Error('Meeting recording works on Android only.');
      await AudioChunks.cut(recordingUri, 0, WHOLE_MS, itemFile(itemId, 'audio.m4a').uri);
    },
    undefined,
    saved,
    id,
  );

export const addPhoto = (uri: string) =>
  addItem('image', captureTitle('image', new Date()), (id) => new File(uri).copy(itemFile(id, 'image.jpg')));

export const addSharedAudio = (src: File, ext: AudioExt, title: string) =>
  addItem('audio', title, (id) => src.move(itemFile(id, `audio.${ext}`)));

// Decoded and written again as an upright JPEG, so every image item's image.jpg is a JPEG whatever was shared.
export const addSharedPhoto = (src: File, title: string) =>
  addItem('image', title, async (id) => {
    await PdfScan.importImage(src.uri, itemFile(id, 'image.jpg').uri);
  });

export async function saveNote(item: Item, text: string): Promise<void> {
  const lib = await openLibrary();
  itemFile(item.id, 'note.md').write(text);
  await lib.setBody(item.id, text);
  await lib.updateItem(item.id, { title: noteTitle(text), sizeBytes: dirSize(item.id) });
}
