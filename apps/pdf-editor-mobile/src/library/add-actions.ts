import * as DocumentPicker from 'expo-document-picker';

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

/** The "+" sheet: Scan adds its entries here in Phases 2 and 3, Reader adds "Save a web page". */
export const addActions: AddAction[] = [
  { key: 'open-pdf', label: 'Open a PDF', icon: 'document-outline', run: openPdf },
  { key: 'new-folder', label: 'New folder', icon: 'folder-open-outline', run: (ctx) => ctx.newFolder() },
];
