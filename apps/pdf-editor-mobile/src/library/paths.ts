import { Directory, File, Paths } from 'expo-file-system';

export const libraryRoot = () => new Directory(Paths.document, 'library');
export const itemDir = (itemId: string) => new Directory(libraryRoot(), itemId);
export const itemFile = (itemId: string, name: string) => new File(itemDir(itemId), name);
export const exportDir = () => new Directory(Paths.cache, 'export');

export const entryName = (entry: File | Directory) =>
  decodeURIComponent(entry.uri.replace(/\/+$/, '').split('/').pop() ?? '');
