import type { Item } from '@apps-hub/library-core';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import TextOcr, { allText } from 'text-ocr';

import { addPdf } from '../library/files';
import { openItem } from '../library/open-item';
import { openLibrary } from '../library/open-library';
import { itemFile } from '../library/paths';
import { keepOut, openKnowledge } from '../nexus/worker';

import { candidates, cleanImport, NO_TEXT_PDF, pdfText, photoText, type Candidate, type Imported } from './import.ts';

const savedPages = async (itemId: string) => {
  const file = itemFile(itemId, 'pages.json');
  return file.exists ? file.text() : null;
};

// Fails closed: if the kept-out list cannot be read, no item is offered, since any of them might be kept out.
export async function libraryPdfs(): Promise<Candidate<Item>[]> {
  const items = await (await openLibrary()).list({ kind: 'pdf', everywhere: true, ownOnly: true, sort: 'recent', limit: 100 });
  const excluded = await (await openKnowledge()).excludedIds();
  return candidates(items, { excluded, hasText: async (item) => pdfText(await savedPages(item.id)) !== null });
}

export async function readLibraryPdf(item: Item, keptOut: boolean): Promise<Imported> {
  const text = pdfText(await savedPages(item.id));
  if (text === null) throw new Error(NO_TEXT_PDF);
  return { ...cleanImport(text), from: item.title, keptOut, added: false };
}

export async function readPhoto(): Promise<Imported | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
  const asset = res.assets?.[0];
  if (res.canceled || !asset) return null;
  const text = await photoText(asset.uri, async (uri) => allText((await TextOcr.recognizeFile(uri)).lines));
  return { ...cleanImport(text), from: 'your photo', keptOut: false, added: false };
}

let waiting: { id: string; title: string } | null = null;

// The editor is what reads a PDF's text. The PDF is kept out of Nexus before it opens, so the editor's indexing never queues it for AI.
export async function addPdfToRead(): Promise<boolean> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'] });
  const asset = res.assets?.[0];
  if (res.canceled || !asset) return false;
  const item = await addPdf(asset.uri, null, asset.name);
  await keepOut(item.id);
  waiting = { id: item.id, title: item.title };
  await openItem(item);
  return true;
}

export async function takeWaitingPdf(): Promise<{ title: string; imported: Imported | null } | null> {
  if (!waiting) return null;
  const { id, title } = waiting;
  const text = pdfText(await savedPages(id));
  if (text === null) return { title, imported: null };
  waiting = null;
  return { title, imported: { ...cleanImport(text), from: title, keptOut: false, added: true } };
}
