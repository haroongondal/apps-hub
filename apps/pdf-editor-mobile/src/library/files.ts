import type { Item } from '@apps-hub/library-core';
import { File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';

import { newId } from './ids';
import { openLibrary } from './open-library';
import { exportDir, itemDir, itemFile } from './paths';

export const dirSize = (itemId: string) => itemDir(itemId).size ?? 0;

export async function writeBase64Atomic(target: File, base64: string): Promise<void> {
  const tmp = new File(`${target.uri}.tmp`);
  await FileSystem.writeAsStringAsync(tmp.uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  if (target.exists) target.delete(); // File.move doesn't document overwriting
  tmp.move(target);
}

const titleOf = (fileName: string) =>
  Array.from(fileName.replace(/\.pdf$/i, '').replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').trim())
    .slice(0, 200)
    .join('') || 'Untitled PDF';

export async function addPdf(uri: string, folderId: string | null, name?: string): Promise<Item> {
  const lib = await openLibrary();
  const id = newId();
  const dir = itemDir(id);
  dir.create({ intermediates: true });
  try {
    const source = new File(uri);
    source.copy(itemFile(id, 'document.pdf'));
    const title = titleOf(name ?? decodeURIComponent(source.uri.split('/').pop() ?? ''));
    // Files first, row second: a crash in between leaves a directory the start-up sweep removes.
    return await lib.createItem({ id, kind: 'pdf', title, folderId, sizeBytes: dirSize(id) });
  } catch (error) {
    dir.delete();
    throw error;
  }
}

export function exportPdf(item: Item): string {
  const dir = exportDir();
  dir.create({ intermediates: true, idempotent: true });
  const safe = item.title.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').trim() || 'document';
  const dest = new File(dir, `${safe}.pdf`);
  if (dest.exists) dest.delete();
  itemFile(item.id, 'document.pdf').copy(dest);
  return dest.uri;
}
