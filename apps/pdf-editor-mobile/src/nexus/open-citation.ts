import { locatorLabel, type Source } from '@apps-hub/knowledge-core';
import { router } from 'expo-router';

import { citedPage } from '../editor/goto-page';
import { openItem } from '../library/open-item';
import { openLibrary } from '../library/open-library';

export const citationLabel = (c: Source & { n: number }) => `${c.n} · ${c.title}${c.locator ? `, ${locatorLabel(c.locator)}` : ''}`;

export async function openCitation(c: Source): Promise<void> {
  const item = await (await openLibrary()).getItem(c.itemId);
  if (!item) throw new Error('That item is no longer in your library.');
  if (c.locator && 'startSec' in c.locator) {
    router.push({ pathname: '/item', params: { id: item.id, at: String(c.locator.startSec) } });
    return;
  }
  await openItem(item, citedPage(c.locator) ?? undefined);
}
