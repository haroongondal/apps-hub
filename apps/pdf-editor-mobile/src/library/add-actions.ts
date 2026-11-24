import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { PdfScan } from 'pdf-scan';

import { nextSide } from '../scan/capture-rules';
import { uriToPath } from '../scan/files-expo';
import { openSession, saveSession, sessionDir } from '../scan/session';
import { newPage } from '../scan/session-data';

import { addPdf } from './files';
import type { IconName } from './icon-button';
import { openItem } from './open-item';

export interface AddContext {
  folderId: string | null;
  newFolder(): void;
}

export interface AddAction {
  key: string;
  label: string;
  icon: IconName;
  run(ctx: AddContext): void | Promise<void>;
}

async function openPdf({ folderId }: AddContext) {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'] });
  const asset = res.assets?.[0];
  if (res.canceled || !asset) return;
  await openItem(await addPdf(asset.uri, folderId, asset.name));
}

/** The "+" sheet: Reader adds "Save a web page" here later. */
function scan({ folderId }: AddContext) {
  openSession(folderId);
  router.push('/scan/capture');
}

async function importPhotos({ folderId }: AddContext) {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 20 });
  if (res.canceled || res.assets.length === 0) return;
  let session = openSession(folderId);
  const base = uriToPath(sessionDir().uri);
  const stamp = Date.now();
  let failed = 0;
  for (const [i, asset] of res.assets.entries()) {
    try {
      const name = `cap-${stamp + i}.jpg`;
      const out = await PdfScan.importImage(asset.uri, `${base}/${name}`);
      const quad = session.mode === 'card' ? await PdfScan.detectQuad(`${base}/${name}`, true).catch(() => out.quad) : out.quad;
      const side = nextSide(session.mode, session.pages);
      session = { ...session, pages: [...session.pages, newPage(name, quad, side === 'full' ? null : side)] };
      saveSession(session);
    } catch {
      failed++;
    }
  }
  if (session.pages.length === 0) throw new Error(`Couldn't import ${failed === 1 ? 'that photo' : `those ${failed} photos`}. Pick JPEG or PNG images and try again.`);
  router.push({ pathname: '/scan/review', params: failed > 0 ? { failed: String(failed), total: String(res.assets.length) } : {} });
}

export const addActions: AddAction[] = [
  { key: 'scan', label: 'Scan a document', icon: 'camera-outline', run: scan },
  { key: 'scan-text', label: 'Scan text', icon: 'camera-outline', run: () => router.push('/scan-text') },
  { key: 'import-photos', label: 'Import photos', icon: 'images-outline', run: importPhotos },
  { key: 'open-pdf', label: 'Open a PDF', icon: 'document-outline', run: openPdf },
  { key: 'new-folder', label: 'New folder', icon: 'folder-open-outline', run: (ctx) => ctx.newFolder() },
];
