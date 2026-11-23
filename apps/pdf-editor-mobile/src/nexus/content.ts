import { planSource, transcribeInChunks, type ContentPort, type Segment, type TranscribeSource } from '@apps-hub/knowledge-core';
import { AudioChunks } from 'audio-chunks';
import { File, Paths } from 'expo-file-system';

import { openLibrary } from '../library/open-library';
import { itemFile } from '../library/paths';

import { ai } from './ai';
import { pieceStore } from './piece-store';

const MAX_UPLOAD = 25 * 1024 * 1024; // the transcription API's file limit
const upload = (file: File) => ai.transcribe({ uri: file.uri, name: 'audio.m4a', type: 'audio/mp4' });

interface Piece {
  file: File;
  temp: boolean; // a cut we made, to delete after the upload
}

/**
 * Transcribes a recording made of one file or several (a meeting's rolling segment files), each with its start in
 * the whole recording. Files are cut under the limit with no re-encoding and sent one piece at a time; the
 * transcript keeps the whole recording's times. Finished pieces are saved (see `pieceStore`), so a retry or a
 * restart sends only what is missing; `content.saved` removes them once the transcript is stored.
 */
export async function transcribeFiles(itemId: string, files: { file: File; offsetMs: number }[]): Promise<Segment[]> {
  const cutter = AudioChunks;
  if (!cutter) throw new Error('This recording is over 25 MB, too long to transcribe on this phone.');
  const source: TranscribeSource = await Promise.all(
    files.map(async ({ file, offsetMs }) => ({
      key: `${file.uri}|${file.size}|${file.modificationTime}`, // a replaced or edited file is a new recording
      bytes: file.size,
      durationMs: await cutter.durationMs(file.uri),
      offsetMs,
    })),
  );
  return transcribeInChunks<Piece>({
    windows: planSource(source, MAX_UPLOAD),
    store: pieceStore(itemId),
    cut: async (w, i) => {
      const { file } = files[w.file ?? 0];
      if (w.startMs === 0 && w.endMs >= source[w.file ?? 0].durationMs && file.size <= MAX_UPLOAD) return { file, temp: false };
      const piece = new File(Paths.cache, `transcribe-${itemId}-${i}.m4a`);
      if (piece.exists) piece.delete(); // left over from a run the system killed
      const bytes = await cutter.cut(file.uri, w.startMs, w.endMs, piece.uri);
      if (bytes <= MAX_UPLOAD) return { file: piece, temp: true };
      piece.delete();
      throw new Error('That piece came out over 25 MB.');
    },
    transcribe: (piece) => upload(piece.file),
    release: (piece) => {
      if (piece.temp && piece.file.exists) piece.file.delete();
    },
  });
}

export const content: ContentPort = {
  async segments(item): Promise<Segment[]> {
    if (item.kind === 'note') {
      const file = itemFile(item.id, 'note.md');
      return [{ text: file.exists ? await file.text() : '', locator: null }];
    }
    if (item.kind === 'audio') {
      const file = itemFile(item.id, 'audio.m4a');
      if (!file.exists) throw new Error('The recording is missing from this device.');
      return file.size > MAX_UPLOAD ? transcribeFiles(item.id, [{ file, offsetMs: 0 }]) : upload(file);
    }
    if (item.kind === 'image') {
      const file = itemFile(item.id, 'image.jpg');
      if (!file.exists) throw new Error('The image is missing from this device.');
      return [{ text: await ai.readImage(await file.base64()), locator: null }];
    }
    if (item.kind === 'pdf') {
      const pages = itemFile(item.id, 'pages.json');
      if (pages.exists) return (JSON.parse(await pages.text()) as string[]).map((text, i) => ({ text, locator: { page: i + 1 } }));
    }
    return [{ text: await (await openLibrary()).getBody(item.id), locator: null }];
  },
  async saved(item) {
    if (item.kind === 'audio') await pieceStore(item.id).clear();
  },
};
