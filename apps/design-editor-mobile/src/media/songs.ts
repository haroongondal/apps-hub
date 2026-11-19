import * as FileSystem from 'expo-file-system/legacy';
import { parseSongPage, songSearchUrl, type SongHit, type SongPage } from '@apps-hub/media-core';

// The token is the person's own Freesound key, kept in the app's private folder. It is never built into the app.
const TOKEN_FILE = () => `${FileSystem.documentDirectory}freesound.json`;
const SONG_DIR = () => `${FileSystem.documentDirectory}songs/`;

export async function loadToken(): Promise<string> {
  try {
    const { token } = JSON.parse(await FileSystem.readAsStringAsync(TOKEN_FILE())) as { token?: unknown };
    return typeof token === 'string' ? token : '';
  } catch {
    return '';
  }
}

export const saveToken = (token: string) =>
  FileSystem.writeAsStringAsync(TOKEN_FILE(), JSON.stringify({ token: token.trim() }));

export async function searchSongs(query: string, token: string, page: number): Promise<SongPage> {
  let res: Response;
  try {
    res = await fetch(songSearchUrl(query, token, page));
  } catch {
    throw new Error("Couldn't reach Freesound. Check the connection and try again.");
  }
  if (res.status === 401 || res.status === 403) throw new Error('Freesound did not accept this key. Check it and try again.');
  if (res.status === 429) throw new Error('Freesound is busy. Wait a minute and try again.');
  if (!res.ok) throw new Error("Couldn't search Freesound. Try again.");
  return parseSongPage(await res.json());
}

// A song is kept by its Freesound id, so picking it again reuses the file instead of downloading it twice.
export async function downloadSong(hit: SongHit): Promise<{ uri: string; name: string; durationS: number }> {
  await FileSystem.makeDirectoryAsync(SONG_DIR(), { intermediates: true });
  const uri = `${SONG_DIR()}${hit.id}.mp3`;
  if (!(await FileSystem.getInfoAsync(uri)).exists) {
    const res = await FileSystem.downloadAsync(hit.previewUrl, uri);
    if (res.status !== 200) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
      throw new Error("Couldn't download this song. Try another one.");
    }
  }
  return { uri, name: hit.name, durationS: hit.durationS };
}
