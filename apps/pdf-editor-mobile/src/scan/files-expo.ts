import type { ByteSink, ScanFiles } from '@apps-hub/scan-core';
import { Directory, File } from 'expo-file-system';

export const pathToUri = (path: string) => `file://${path.split('/').map(encodeURIComponent).join('/')}`;
export const uriToPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, '')).replace(/(.)\/+$/, '$1');

const dirAt = (path: string) => new Directory(pathToUri(path));
const fileAt = (path: string) => new File(pathToUri(path));

// The constructors throw when the path exists as the other kind.
const isDir = (path: string) => {
  try {
    return dirAt(path).exists;
  } catch {
    return false;
  }
};
const isFile = (path: string) => {
  try {
    return fileAt(path).exists;
  } catch {
    return false;
  }
};

function remove(path: string) {
  if (isDir(path)) dirAt(path).delete();
  else if (isFile(path)) fileAt(path).delete();
}

export const expoFiles: ScanFiles = {
  async makeDir(path) {
    dirAt(path).create({ intermediates: true, idempotent: true });
  },
  async move(from, to) {
    remove(to);
    if (isDir(from)) dirAt(from).move(dirAt(to));
    else fileAt(from).move(fileAt(to));
  },
  async copy(from, to) {
    remove(to);
    fileAt(from).copy(fileAt(to));
  },
  async remove(path) {
    remove(path);
  },
  async exists(path) {
    return isDir(path) || isFile(path);
  },
  async size(path) {
    return isDir(path) ? (dirAt(path).size ?? 0) : fileAt(path).size;
  },
  read(path) {
    return fileAt(path).bytes();
  },
  async open(path): Promise<ByteSink & { close(): Promise<void> }> {
    const file = fileAt(path);
    file.create({ overwrite: true, intermediates: true });
    const handle = file.open();
    return {
      write: (bytes) => handle.writeBytes(bytes),
      close: async () => handle.close(),
    };
  },
};
