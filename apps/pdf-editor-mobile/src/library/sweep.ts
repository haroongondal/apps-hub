import { orphanDirs, type Library } from '@apps-hub/library-core';
import { Directory } from 'expo-file-system';

import { entryName, exportDir, libraryRoot } from './paths';

export async function sweepLibrary(lib: Library): Promise<void> {
  const root = libraryRoot();
  if (root.exists) {
    for (const name of orphanDirs(root.list().map(entryName), await lib.allIds())) {
      new Directory(root, name).delete();
    }
  }
  const exports = exportDir();
  if (exports.exists) exports.delete();
}
