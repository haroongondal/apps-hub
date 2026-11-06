import * as FileSystem from 'expo-file-system/legacy';

import type { AutosaveRecord } from './bridge';

// On-phone storage for the Designs tab and the editor's autosave (SPEC §14.3):
// - documentDirectory/autosave.json — the page's record { filePath, dirty, doc }, exactly what
//   the desktop keeps; the page restores it on every boot.
// - documentDirectory/designs/index.json — why the Designs tab lists: each row mirrors a save
//   to Documents/Design Editor (the mirror file keeps opening offline-fast, no MediaStore reads).
//   The display path recorded in the row stays what docName() shows.
const AUTOSAVE = FileSystem.documentDirectory + 'autosave.json';
const DESIGNS_DIR = FileSystem.documentDirectory + 'designs/';
export const DESIGNS_INDEX = DESIGNS_DIR + 'index.json';

export type SavedDesign = { id: string; name: string; path: string; added: number };

export function designTitle(path: string | null | undefined): string {
  return path ? path.split(/[\\/]/).pop()?.replace(/\.json$/i, '') ?? 'Untitled design' : 'Untitled design';
}

export async function readAutosave(): Promise<AutosaveRecord | null> {
  const info = await FileSystem.getInfoAsync(AUTOSAVE);
  if (!info.exists) return null;
  return readAutosaveText(info.size);
}

// Split from readAutosave so a record that wasted away to zero bytes still reads as "none stored".
async function readAutosaveText(size: number): Promise<AutosaveRecord | null> {
  if (size === 0) return null;
  try {
    const record = JSON.parse(await FileSystem.readAsStringAsync(AUTOSAVE)) as AutosaveRecord;
    if (typeof record?.doc !== 'string') return null;
    return record;
  } catch {
    return null;
  }
}

export async function writeAutosave(record: AutosaveRecord): Promise<void> {
  await FileSystem.writeAsStringAsync(AUTOSAVE, JSON.stringify(record));
}

export async function clearAutosave(): Promise<void> {
  const info = await FileSystem.getInfoAsync(AUTOSAVE);
  if (info.exists) await FileSystem.deleteAsync(AUTOSAVE, { idempotent: true });
}

export async function readSavedList(): Promise<SavedDesign[]> {
  const info = await FileSystem.getInfoAsync(DESIGNS_INDEX);
  if (!info.exists) return [];
  try {
    const list = JSON.parse(await FileSystem.readAsStringAsync(DESIGNS_INDEX)) as SavedDesign[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function readDesignText(design: SavedDesign): Promise<string | null> {
  try {
    return await FileSystem.readAsStringAsync(DESIGNS_DIR + design.id + '.json');
  } catch {
    return null;
  }
}

// Upsert by display path (a re-save keeps its row and its date), names follow new saves, newest
// first. Returns the surviving row's id, so the caller can overwrite that row's mirror file
// instead of accumulating one mirror per save.
export async function recordSaved(design: { id: string; name: string; path: string }): Promise<string> {
  await makeDesignsDir();
  const list = await readSavedList();
  const previous = list.find(d => d.path === design.path);
  if (previous && previous.id !== design.id) await removeMirror(previous.id);
  const entry: SavedDesign = {
    id: previous?.id ?? design.id,
    name: design.name,
    path: design.path,
    added: previous?.added ?? Date.now(),
  };
  const next = [entry, ...list.filter(d => d.id !== entry.id && d.path !== design.path)].slice(0, 50);
  await FileSystem.writeAsStringAsync(DESIGNS_INDEX, JSON.stringify(next));
  return entry.id;
}

export async function writeDesignMirror(id: string, text: string): Promise<void> {
  await makeDesignsDir();
  await FileSystem.writeAsStringAsync(DESIGNS_DIR + id + '.json', text);
}

export async function removeMirror(id: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(DESIGNS_DIR + id + '.json');
  if (info.exists) await FileSystem.deleteAsync(DESIGNS_DIR + id + '.json', { idempotent: true });
}

export async function makeDesignsDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DESIGNS_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DESIGNS_DIR, { intermediates: true });
}
