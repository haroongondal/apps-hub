import { Directory, File, Paths } from 'expo-file-system';

import { entryName } from '../library/paths';
import { newSession, restoreSession, type ScanSession } from './session-data';

export const sessionDir = () => new Directory(Paths.document, 'scan-session');
const jsonFile = () => new File(sessionDir(), 'session.json');
const tmpFile = () => new File(sessionDir(), 'session.json.tmp');

export function loadSession(): ScanSession | null {
  const dir = sessionDir();
  if (!dir.exists) return null;
  let text: string | null = null;
  try {
    // A crash between deleting session.json and moving the temp file over it leaves only the temp file.
    const f = jsonFile().exists ? jsonFile() : tmpFile();
    text = f.exists ? f.textSync() : null;
  } catch {
    text = null;
  }
  return restoreSession(text, dir.list().map(entryName), Date.now());
}

export function saveSession(session: ScanSession): void {
  sessionDir().create({ intermediates: true, idempotent: true });
  const tmp = tmpFile();
  tmp.write(JSON.stringify(session));
  const target = jsonFile();
  if (target.exists) target.delete(); // File.move doesn't document overwriting
  tmp.move(target);
}

/** The unsaved session if it has pages, else a new one that saves into [folderId]. */
export function openSession(folderId: string | null): ScanSession {
  const existing = loadSession();
  if (existing && existing.pages.length > 0) return existing;
  const session = newSession(folderId, Date.now());
  saveSession(session);
  return session;
}

export function discardSession(): void {
  const dir = sessionDir();
  if (dir.exists) dir.delete();
}

/** Deletes one captured photo. Done before the session is saved without it, so a crash in between leaves a page whose file is gone, which loadSession drops. */
export function deleteCapture(file: string): void {
  const capture = new File(sessionDir(), file);
  if (capture.exists) capture.delete();
}
