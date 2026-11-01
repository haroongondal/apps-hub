import {
  ftsQuery,
  LibraryError,
  type Folder,
  type Item,
  type ItemKind,
  type Library,
  type Tag,
} from '@apps-hub/library-core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

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
}

const EMPTY: LibraryData = { loading: true, error: null, path: [], tags: [], kinds: [], rows: [] };

export function errorMessage(error: unknown): string {
  if (error instanceof LibraryError && error.code === 'too_new') {
    return 'This library was made by a newer version of PDF Editor.';
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
      const [path, tags, kindRows] = await Promise.all([
        q.folderId ? lib.folderPath(q.folderId) : Promise.resolve<Folder[]>([]),
        lib.listTags(),
        lib.db.all('SELECT DISTINCT kind FROM items'),
      ]);
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
        setData({ loading: false, error: null, path, tags, kinds: kindRows.map((r) => r.kind as ItemKind), rows });
      }
    } catch (error) {
      if (run === latest.current) setData((d) => ({ ...d, loading: false, error: errorMessage(error) }));
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
