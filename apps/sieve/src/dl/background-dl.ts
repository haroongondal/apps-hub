import { initMenus } from './menus.ts';
import { initRouter } from './router.ts';
import { initSave } from './save.ts';
import { initTakeover } from './takeover.ts';

// Listeners must be added at the top level so Chrome can deliver the event that woke a stopped worker.
export function initDownloads(): void {
  throw new Error('not implemented');
}
void [initMenus, initRouter, initSave, initTakeover];
