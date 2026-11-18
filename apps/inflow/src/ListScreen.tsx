import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Button, Empty, Group, Header, Notice, Screen, space, useTheme } from '@apps-hub/ui';
import InflowCore, { type Item, type ItemFilter } from 'inflow-core';
import { ItemRow } from './ItemRow.tsx';
import { ItemSheet } from './ItemSheet.tsx';
import { LOAD_ERROR } from './messages.ts';
import { ConversationMenu, ItemMenu, itemRenameTarget } from './RecordMenus.tsx';
import { RenameSheet, type RenameTarget } from './RenameSheet.tsx';

const PAGE = 50;

export function ListScreen({ title, filter, onBack, onOpen }: { title: string; filter: ItemFilter; onBack: () => void; onOpen: (filter: ItemFilter, title: string) => void }) {
  const { c } = useTheme();
  const [items, setItems] = useState<Item[]>([]);
  const [more, setMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const busy = useRef(false);
  const count = useRef(0);

  const load = useCallback(
    (reset: boolean, before: Item | null) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const limit = reset ? Math.max(PAGE, count.current) : PAGE;
        const page = InflowCore.listItems(filter, reset || before === null ? null : before.postedAt, limit, reset || before === null ? null : before.id);
        setItems((prev) => (reset ? page : [...prev, ...page]));
        count.current = reset ? page.length : count.current + page.length;
        setMore(page.length >= limit);
        setError(null);
      } catch {
        setError(LOAD_ERROR);
        setMore(false);
      } finally {
        busy.current = false;
        setLoaded(true);
      }
    },
    [filter],
  );

  useEffect(() => load(true, null), [load]);

  const now = Date.now();
  const last = items.length > 0 ? items[items.length - 1] : null;
  const reload = () => load(true, null);
  // A conversation list gets a menu of its own: rename the sender, or delete every message and leave the emptied list.
  const conversationMenu =
    filter.kind === 'conversation' ? (
      <ConversationMenu
        conversationKey={filter.key}
        name={title}
        onRename={setRenaming}
        onChanged={onBack}
        onError={setError}
      />
    ) : undefined;
  return (
    <Screen>
      <View style={{ paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.md }}>
        <Button label="Back" variant="ghost" size="sm" onPress={onBack} />
        <Header title={title} trailing={conversationMenu} />
      </View>
      {error !== null && (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
          <Notice tone="danger">{error}</Notice>
        </View>
      )}
      <FlatList
        style={{ backgroundColor: c.bg }}
        data={items}
        keyExtractor={(i) => String(i.id)}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl, gap: space.md }}
        renderItem={({ item }) => (
          <Group>
            <ItemRow
              item={item}
              now={now}
              onPress={() => setSelected(item)}
              menu={<ItemMenu item={item} onRename={setRenaming} onChanged={reload} onError={setError} />}
            />
          </Group>
        )}
        onEndReached={() => more && last !== null && load(false, last)}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={loaded && error === null ? <Empty title="Nothing here yet" body="Notifications that match will appear here." /> : null}
      />
      <ItemSheet
        item={selected}
        onClose={() => setSelected(null)}
        onRename={(item) => {
          setSelected(null);
          setRenaming(itemRenameTarget(item));
        }}
        onDeleted={() => {
          setSelected(null);
          reload();
        }}
        onShowSender={(name) => {
          setSelected(null);
          onOpen({ kind: 'sender', name }, name);
        }}
      />
      <RenameSheet
        target={renaming}
        onClose={() => setRenaming(null)}
        onSaved={() => {
          setRenaming(null);
          reload();
        }}
      />
    </Screen>
  );
}
