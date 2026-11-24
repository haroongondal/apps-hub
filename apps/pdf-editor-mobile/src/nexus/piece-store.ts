import type { PieceStore } from '@apps-hub/knowledge-core';
import { Directory, File } from 'expo-file-system';

import { itemDir } from '../library/paths';

/** Finished transcript pieces of one recording, in `library/<id>/transcribe/`, so they go with the item when it is deleted. */
export function pieceStore(itemId: string): PieceStore {
  const dir = () => new Directory(itemDir(itemId), 'transcribe');
  const record = (index: number) => new File(dir(), `piece-${index}.json`);
  return {
    async read(index) {
      const file = record(index);
      return file.exists ? file.text() : null;
    },
    async write(index, text) {
      dir().create({ intermediates: true, idempotent: true });
      record(index).write(text);
    },
    async clear() {
      if (dir().exists) dir().delete();
    },
  };
}
