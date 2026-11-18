import type { ContentPort, Segment } from '@apps-hub/knowledge-core';

import { openLibrary } from '../library/open-library';
import { itemFile } from '../library/paths';

import { ai } from './ai';

const MAX_UPLOAD = 25 * 1024 * 1024; // the transcription API's file limit

export const content: ContentPort = {
  async segments(item): Promise<Segment[]> {
    if (item.kind === 'note') {
      const file = itemFile(item.id, 'note.md');
      return [{ text: file.exists ? await file.text() : '', locator: null }];
    }
    if (item.kind === 'audio') {
      const file = itemFile(item.id, 'audio.m4a');
      if (!file.exists) throw new Error('The recording is missing from this device.');
      // shortcut: one upload per recording, so notes over ~50 min (25 MB at 64 kbps) fail; split them when that matters.
      if (file.size > MAX_UPLOAD) throw new Error('This recording is over 25 MB, too long to transcribe in one go.');
      return ai.transcribe({ uri: file.uri, name: 'audio.m4a', type: 'audio/mp4' });
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
