import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { PdfScan } from 'pdf-scan';

import { confirmLarge } from '../library/open-item';
import { openLibrary } from '../library/open-library';

import { pathToUri } from './files-expo';
import { getScanService } from './service';

export const GALLERY_ALBUM = 'PDF Editor';

export const savedMessage = (n: number) => `Saved ${n} ${n === 1 ? 'image' : 'images'} to Photos`;

export async function sharePdf(itemId: string): Promise<void> {
  const { path } = await (await getScanService()).buildPdf(itemId);
  await Sharing.shareAsync(pathToUri(path), { mimeType: 'application/pdf', dialogTitle: 'Share PDF', UTI: 'com.adobe.pdf' });
}

/** Returns how many images were saved. */
export async function saveImages(itemId: string, pageIds?: string[]): Promise<number> {
  const paths = await (await getScanService()).imagePaths(itemId, pageIds);
  return PdfScan.saveImagesToGallery(paths, GALLERY_ALBUM);
}

export async function shareImages(itemId: string, pageIds?: string[]): Promise<void> {
  const paths = await (await getScanService()).imagePaths(itemId, pageIds);
  await PdfScan.shareImages(paths, 'Share images');
}

export async function openInEditor(itemId: string): Promise<void> {
  const item = await (await openLibrary()).getItem(itemId);
  if (!item) throw new Error('This scan is no longer in the library. Go back and open it from the list.');
  const { path, bytes } = await (await getScanService()).buildPdf(itemId);
  if (!(await confirmLarge(bytes))) return;
  router.push({ pathname: '/editor', params: { uri: pathToUri(path), name: `${item.title}.pdf`, itemId } });
}
