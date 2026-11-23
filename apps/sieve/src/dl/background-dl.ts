import { initMenus } from './menus.ts';
import { initNetRules } from './net-rules.ts';
import { initRouter } from './router.ts';
import { initSave } from './save.ts';
import { initTakeover } from './takeover.ts';

// Listeners must be added synchronously at the top level so Chrome can deliver the event that woke a stopped worker.
export function initDownloads(): void {
  initNetRules();
  initRouter();
  initSave();
  initTakeover();
  initMenus();
}
