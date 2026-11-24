import type { ShareRead } from 'design-media';
import { SHARE_MAX_ITEMS, claimedKind, classifyShare, type SharedItem } from '@apps-hub/media-core';

export interface IntakeDeps {
  take(): Promise<ShareRead>;
  move(from: string, to: string): Promise<void>;
  remove(uri: string): Promise<void>;
}
export interface Received { items: SharedItem[]; notes: string[] }
export type InboxItem = Omit<SharedItem, 'format'>;
export interface InboxDeps {
  root: string; // folder URI ending in /, one numbered folder per share inside
  readDir(uri: string): Promise<string[]>;
  sizeOf(uri: string): Promise<number>;
}

const folderOf = (uri: string) => uri.slice(0, uri.lastIndexOf('/') + 1);
export const inboxUri = (folder: string, name: string) => `${folder}${encodeURIComponent(name)}`;

// The one way shared pictures and videos come in, for the share sheet today and an action activity later.
// What arrives is copied already; this keeps what is really a JPEG, PNG or video, names it safely and drops the rest.
export async function receiveShare(deps: IntakeDeps): Promise<Received> {
  const read = await deps.take();
  const batch = classifyShare(read.items);
  const notes = [...batch.refused];
  if (read.overCap > 0 && !notes.some(n => n.startsWith('Only the first'))) notes.push(`Only the first ${SHARE_MAX_ITEMS} were added.`);
  if (read.blocked > 0) notes.push('Some items could not be added because they were not sent as files.');
  await Promise.all(batch.discard.filter(Boolean).map(uri => deps.remove(uri).catch(() => undefined)));
  const items: SharedItem[] = [];
  for (const item of batch.items) {
    const to = inboxUri(folderOf(item.uri), item.name);
    try {
      await deps.move(item.uri, to);
      items.push({ ...item, uri: to });
    } catch {
      await deps.remove(item.uri).catch(() => undefined);
      notes.push(`${item.name} couldn't be saved. Share it again.`);
    }
  }
  return { items, notes };
}

// Everything shared and not yet removed, newest first. The names are the cleaned ones the folder holds.
export async function listInbox(deps: InboxDeps): Promise<InboxItem[]> {
  const batches = (await deps.readDir(deps.root).catch(() => [] as string[])).filter(n => /^\d+$/.test(n)).sort((a, b) => Number(b) - Number(a));
  const found: InboxItem[] = [];
  for (const batch of batches) {
    const folder = `${deps.root}${batch}/`;
    const names = (await deps.readDir(folder).catch(() => [] as string[])).filter(n => !n.endsWith('.part')).sort();
    for (const name of names) {
      const kind = claimedKind('', name);
      if (!kind) continue;
      const uri = inboxUri(folder, name);
      found.push({ uri, name, kind, bytes: await deps.sizeOf(uri).catch(() => 0) });
    }
  }
  return found;
}
