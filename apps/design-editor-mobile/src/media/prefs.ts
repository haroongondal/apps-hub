import * as FileSystem from 'expo-file-system/legacy';

// Small remembered choices (PRD FR-3: the smaller-file choice is remembered). Never anything about the files.
const FILE = () => `${FileSystem.documentDirectory}media-prefs.json`;
export interface Prefs { smallerFile: boolean }

export async function loadPrefs(): Promise<Prefs> {
  try { return { smallerFile: false, ...(JSON.parse(await FileSystem.readAsStringAsync(FILE())) as Partial<Prefs>) }; } catch { return { smallerFile: false }; }
}
export const savePrefs = (p: Prefs) => FileSystem.writeAsStringAsync(FILE(), JSON.stringify(p)).catch(() => undefined);
