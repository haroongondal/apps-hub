import {
  ftsQuery,
  LibraryError,
  type Folder,
  type Item,
  type ItemKind,
  type ItemSource,
  type SourceApp,
  type Library,
  type Tag,
} from '@apps-hub/library-core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { openKnowledge } from '../nexus/worker';

import { openLibrary } from './open-library';

export interface LibraryQuery {
  folderId: string | null;
  text: string;
  kind: ItemKind | null;
  tagId: string | null;
  sort: 'recent' | 'title';
}

export type LibraryRow =
  | { type: 'folder'; key: string; folder: Folder }
  | { type: 'item'; key: string; item: Item; snippet: string | null; where: string | null };

export interface LibraryData {
  loading: boolean;
  error: string | null;
  path: Folder[];
  tags: Tag[];
  kinds: ItemKind[];
  rows: LibraryRow[];
  /** Items kept out of Nexus. Nexus failing to open must not stop the Library, so it reads as none. */
  keptOut: Set<string>;
  /** Items read from other apps, by item id: they are copies, so the Library offers no rename or delete for them. */
  sources: Map<string, ItemSource>;
  /** The folder being shown no longer exists, for instance because it held what a switched-off source had left. */
  gone: boolean;
}

const EMPTY: LibraryData = { loading: true, error: null, path: [], tags: [], kinds: [], rows: [], keptOut: new Set(), sources: new Map(), gone: false };

export function errorMessage(error: unknown): string {
  if (error instanceof LibraryError && error.code === 'too_new') {
    return 'This library was made by a newer version of Nexus.';
  }
  return error instanceof Error ? error.message : String(error);
}

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

async function whereLabels(lib: Library, folderIds: readonly (string | null)[]) {
  const unique = [...new Set(folderIds.filter((id): id is string => id !== null))];
  const labels = await Promise.all(
    unique.map(async (id) => [id, (await lib.folderPath(id)).map((f) => f.name).join(' / ')] as const),
  );
  return new Map(labels);
}

export function useLibraryData(q: LibraryQuery) {
  const [data, setData] = useState<LibraryData>(EMPTY);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const run = ++latest.current;
    try {
      const lib = await openLibrary();
      const kind = q.kind ?? undefined;
      const tagId = q.tagId ?? undefined;
      const filtered = kind !== undefined || tagId !== undefined;
      const [path, tags, kindRows, keptOut, sourceRows] = await Promise.all([
        q.folderId ? lib.folderPath(q.folderId) : Promise.resolve<Folder[]>([]),
        lib.listTags(),
        lib.db.all('SELECT DISTINCT kind FROM items'),
        openKnowledge()
          .then((kn) => kn.excludedIds())
          .catch(() => new Set<string>()),
        lib.db.all('SELECT item_id, app, source_id, source_at FROM item_sources'),
      ]);
      const sources = new Map(
        sourceRows.map((r) => [r.item_id as string, { app: r.app as SourceApp, sourceId: r.source_id as number, sourceAt: r.source_at as number }] as const),
      );
      let rows: LibraryRow[];
      if (ftsQuery(q.text) !== null) {
        const hits = await lib.search(q.text, { kind, tagId });
        const where = await whereLabels(lib, hits.map((h) => h.folderId));
        rows = hits.map(({ snippet, ...item }) => ({
          type: 'item',
          key: item.id,
          item,
          snippet,
          where: item.folderId ? (where.get(item.folderId) ?? null) : 'Library',
        }));
      } else {
        // A kind or tag filter is a library-wide view, so it ignores the folder.
        const folders = filtered ? [] : await lib.listFolders(q.folderId);
        const items = await lib.list({ folderId: q.folderId, everywhere: filtered, kind, tagId, sort: q.sort });
        rows = [
          ...folders.map((folder): LibraryRow => ({ type: 'folder', key: `f${folder.id}`, folder })),
          ...items.map((item): LibraryRow => ({ type: 'item', key: item.id, item, snippet: null, where: null })),
        ];
      }
      if (run === latest.current) {
        setData({ loading: false, error: null, path, tags, kinds: kindRows.map((r) => r.kind as ItemKind), rows, keptOut, sources, gone: false });
      }
    } catch (error) {
      const gone = error instanceof LibraryError && error.code === 'not_found' && q.folderId !== null;
      if (run === latest.current) setData((d) => ({ ...d, loading: false, error: gone ? null : errorMessage(error), gone }));
    }
  }, [q.folderId, q.text, q.kind, q.tagId, q.sort]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { ...data, reload };
}

export interface FolderChoice {
  id: string;
  label: string;
}

// Leaves out excludeId and everything inside it, so a folder can't be offered a move into itself.
export async function folderChoices(lib: Library, excludeId: string | null): Promise<FolderChoice[]> {
  const rows = await lib.db.all('SELECT id, name, parent_id FROM folders');
  const byId = new Map(rows.map((r) => [r.id as string, { name: r.name as string, parent: r.parent_id as string | null }]));
  const chain = (id: string) => {
    const names: string[] = [];
    const ids: string[] = [];
    for (let cur: string | null = id; cur !== null && byId.has(cur); cur = byId.get(cur)!.parent) {
      names.unshift(byId.get(cur)!.name);
      ids.push(cur);
    }
    return { names, ids };
  };
  return [...byId.keys()]
    .map((id) => ({ id, ...chain(id) }))
    .filter((f) => excludeId === null || !f.ids.includes(excludeId))
    .map((f) => ({ id: f.id, label: f.names.join(' / ') }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
