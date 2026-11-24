import type { InboxItem } from './share-intake.ts';
import { TOOLS, isSingle } from './tools.ts';

// Tools that can take every ticked item: one kind at a time, and one file only for the tools that work on one.
export function toolsFor(ticked: InboxItem[]) {
  const kinds = new Set(ticked.map(i => i.kind));
  if (kinds.size !== 1) return [];
  const [kind] = kinds;
  return TOOLS.filter(t => t.accept.includes(kind === 'image' ? 'image' : 'video') && (ticked.length === 1 || !isSingle(t.key)));
}

export const mixedKinds = (ticked: InboxItem[]) => new Set(ticked.map(i => i.kind)).size > 1;

// First item's kind, so a mixed share starts with one kind chosen and a list the tools can take.
export function defaultTicked(items: InboxItem[]): string[] {
  return items.filter(i => i.kind === items[0]?.kind).map(i => i.uri);
}

let handoff: InboxItem[] = [];
export const handOff = (items: InboxItem[]) => { handoff = items; };
export function takeHandoff(): InboxItem[] {
  const items = handoff;
  handoff = [];
  return items;
}
