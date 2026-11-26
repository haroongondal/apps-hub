import { openLibrary } from '../library/open-library';
import { dirSize, writeBase64Atomic } from '../library/files';
import { itemFile } from '../library/paths';
import type { PageEvent } from '../editor/bridge';

import { enqueue } from './worker';

export type DocInfo = Extract<PageEvent, { type: 'docInfo' }>;

export async function indexPdfItem(itemId: string, info: DocInfo) {
  try {
    const lib = await openLibrary();
    await lib.setBody(itemId, info.text.join('\n\n'));
    const thumb = itemFile(itemId, 'thumb.jpg');
    if (info.thumb && !thumb.exists) await writeBase64Atomic(thumb, info.thumb);
    const pages = itemFile(itemId, 'pages.json');
    const text = JSON.stringify(info.text);
    const changed = !pages.exists || (await pages.text()) !== text;
    if (changed) pages.write(text); // Nexus cites PDFs by page, so it keeps the text per page
    await lib.updateItem(itemId, { pageCount: info.pages, sizeBytes: dirSize(itemId) });
    if (changed) await enqueue(itemId);
  } catch (err) {
    console.warn('Could not index the PDF', err);
  }
}
