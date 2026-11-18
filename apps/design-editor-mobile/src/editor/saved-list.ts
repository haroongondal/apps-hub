export type SavedDesign = { id: string; name: string; path: string; added: number; renamed?: boolean };

export const MAX_SAVED = 50;
export const MAX_NAME = 80;

// Upsert by display path (a re-save keeps its row, its date and a name the person chose), newest
// first. `dropped` are the rows pushed off the end, so the caller can delete their mirror files.
export function upsertSaved(
  list: SavedDesign[],
  design: { id: string; name: string; path: string },
  now: number,
): { next: SavedDesign[]; entry: SavedDesign; dropped: SavedDesign[] } {
  const previous = list.find(d => d.path === design.path);
  const entry: SavedDesign = {
    id: previous?.id ?? design.id,
    name: previous?.renamed ? previous.name : design.name,
    path: design.path,
    added: previous?.added ?? now,
    ...(previous?.renamed ? { renamed: true } : {}),
  };
  const ordered = [entry, ...list.filter(d => d.id !== entry.id && d.path !== design.path)];
  return { next: ordered.slice(0, MAX_SAVED), entry, dropped: ordered.slice(MAX_SAVED) };
}

export const removeSaved = (list: SavedDesign[], id: string): SavedDesign[] => list.filter(d => d.id !== id);

// The name a person typed, or null when it is empty once tidied. Slashes would read as a folder in the path.
export function cleanDesignName(raw: string): string | null {
  const name = raw.replace(/[\\/]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.json$/i, '').trim();
  return name ? Array.from(name).slice(0, MAX_NAME).join('') : null;
}

export function renameSaved(list: SavedDesign[], id: string, raw: string): SavedDesign[] | null {
  const name = cleanDesignName(raw);
  if (!name || !list.some(d => d.id === id)) return null;
  return list.map(d => (d.id === id ? { ...d, name, renamed: true } : d));
}
