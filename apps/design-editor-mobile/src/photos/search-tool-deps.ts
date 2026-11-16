import { createDownloadResumable, documentDirectory, getFreeDiskStorageAsync, makeDirectoryAsync } from 'expo-file-system/legacy';
import DesignMedia from 'design-media';
import type { SearchToolDeps } from './search-tool.ts';

export function realSearchToolDeps(): SearchToolDeps {
  return {
    models: () => DesignMedia.photoModels(),
    install: name => DesignMedia.installPhotoModel(name),
    freeBytes: () => getFreeDiskStorageAsync(),
    async download(url, to, onBytes) {
      await makeDirectoryAsync(`${documentDirectory}models/`, { intermediates: true });
      const job = createDownloadResumable(url, `${documentDirectory}${to}`, {}, p => onBytes(p.totalBytesWritten));
      await job.downloadAsync();
    },
  };
}
