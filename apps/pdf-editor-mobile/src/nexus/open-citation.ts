import type { Source } from '@apps-hub/knowledge-core';
import { router } from 'expo-router';

import { citedPage } from '../editor/goto-page';
import { openItem } from '../library/open-item';
import { openLibrary } from '../library/open-library';

export async function openCitation(c: Source): Promise<void> {
  if (c.itemId.startsWith('cv:')) {
    router.push({ pathname: '/cv/[id]', params: { id: c.itemId.slice(3) } });
    return;
  }
  const item = await (await openLibrary()).getItem(c.itemId);
  if (!item) throw new Error('That item is no longer in your library.');
  if (c.locator && 'startSec' in c.locator) {
    router.push({ pathname: '/item', params: { id: item.id, at: String(c.locator.startSec) } });
    return;
  }
  await openItem(item, citedPage(c.locator) ?? undefined);
}
