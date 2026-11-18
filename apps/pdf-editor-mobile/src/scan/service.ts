import { ScanService, ScanStore } from '@apps-hub/scan-core';
import { PdfScan } from 'pdf-scan';

import { newId } from '../library/ids';
import { openLibrary } from '../library/open-library';
import { exportDir, libraryRoot } from '../library/paths';

import { expoFiles, uriToPath } from './files-expo';

let instance: Promise<ScanService> | null = null;

/** One service per process, on the same connection as the Library. */
export function getScanService(): Promise<ScanService> {
  if (!instance) {
    instance = (async () => {
      const library = await openLibrary();
      const store = await ScanStore.open(library.db);
      exportDir().create({ intermediates: true, idempotent: true });
      return new ScanService({
        library,
        store,
        native: PdfScan,
        files: expoFiles,
        libraryDir: uriToPath(libraryRoot().uri),
        exportDir: uriToPath(exportDir().uri),
        newPageId: newId,
        newItemId: newId,
      });
    })();
    instance.catch(() => {
      instance = null;
    });
  }
  return instance;
}
