import { planChunks, transcribeInChunks, type ContentPort, type Segment } from '@apps-hub/knowledge-core';
import { AudioChunks } from 'audio-chunks';
import { File, Paths } from 'expo-file-system';

import { openLibrary } from '../library/open-library';
import { itemFile } from '../library/paths';

import { ai } from './ai';

const MAX_UPLOAD = 25 * 1024 * 1024; // the transcription API's file limit
const upload = (file: File) => ai.transcribe({ uri: file.uri, name: 'audio.m4a', type: 'audio/mp4' });

// Cut into pieces under the limit (no re-encoding), sent one by one; the transcript keeps the whole recording's times.
async function transcribeLong(itemId: string, file: File): Promise<Segment[]> {
  const cutter = AudioChunks;
  if (!cutter) throw new Error('This recording is over 25 MB, too long to transcribe on this phone.');
  const windows = planChunks(await cutter.durationMs(file.uri), file.size, MAX_UPLOAD);
  return transcribeInChunks<File>({
    windows,
    cut: async (w, i) => {
      const piece = new File(Paths.cache, `transcribe-${itemId}-${i}.m4a`);
      if (piece.exists) piece.delete(); // left over from a run the system killed
      const bytes = await cutter.cut(file.uri, w.startMs, w.endMs, piece.uri);
      if (bytes <= MAX_UPLOAD) return piece;
      piece.delete();
      throw new Error('That piece came out over 25 MB.');
    },
    transcribe: upload,
    release: (piece) => {
      if (piece.exists) piece.delete();
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
      return file.size > MAX_UPLOAD ? transcribeLong(item.id, file) : upload(file);
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
};
