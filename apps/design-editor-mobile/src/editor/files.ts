import * as FileSystem from 'expo-file-system/legacy';

import type { AutosaveRecord } from './bridge';
import { removeSaved, renameSaved, upsertSaved, type SavedDesign } from './saved-list';

export type { SavedDesign } from './saved-list';

// On-phone storage for the Designs tab and the editor's autosave (SPEC §14.3):
// - documentDirectory/autosave.json — the page's record { filePath, dirty, doc }, exactly what
//   the desktop keeps; the page restores it on every boot.
// - documentDirectory/designs/index.json — why the Designs tab lists: each row mirrors a save
//   to Documents/Design Editor (the mirror file keeps opening offline-fast, no MediaStore reads).
//   The display path recorded in the row stays what docName() shows.
const AUTOSAVE = FileSystem.documentDirectory + 'autosave.json';
const DESIGNS_DIR = FileSystem.documentDirectory + 'designs/';
export const DESIGNS_INDEX = DESIGNS_DIR + 'index.json';

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

async function writeSavedList(list: SavedDesign[]): Promise<void> {
  await makeDesignsDir();
  await FileSystem.writeAsStringAsync(DESIGNS_INDEX, JSON.stringify(list));
}

// Returns the surviving row's id, so the caller can overwrite that row's mirror file instead of
// accumulating one mirror per save. Rows pushed off the end of the list lose their mirror too.
export async function recordSaved(design: { id: string; name: string; path: string }): Promise<string> {
  const { next, entry, dropped } = upsertSaved(await readSavedList(), design, Date.now());
  await writeSavedList(next);
  await Promise.all(dropped.map(d => removeMirror(d.id)));
  return entry.id;
}

// Takes the design out of the Designs list and deletes this app's mirror copy. The file in
// Documents/Design Editor is never touched: it is the person's own file, in shared storage.
export async function deleteSavedDesign(id: string): Promise<void> {
  await writeSavedList(removeSaved(await readSavedList(), id));
  await removeMirror(id);
}

// Renames the design in the Designs list only; the saved file keeps its name.
// Returns false when the name is empty or the design is no longer listed.
export async function renameSavedDesign(id: string, name: string): Promise<boolean> {
  const next = renameSaved(await readSavedList(), id, name);
  if (!next) return false;
  await writeSavedList(next);
  return true;
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
