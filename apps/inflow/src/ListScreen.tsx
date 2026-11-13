import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Button, Empty, Group, Header, Notice, Pill, Row, Screen, Text, space, useTheme } from '@apps-hub/ui';
import InflowCore, { type Item, type ItemFilter } from 'inflow-core';
import { whenLabel } from './format.ts';
import { ItemSheet } from './ItemSheet.tsx';
import { LOAD_ERROR } from './messages.ts';
import { RenameSheet, type RenameTarget } from './RenameSheet.tsx';

const PAGE = 50;

function ItemRow({ item, now, onPress }: { item: Item; now: number; onPress: () => void }) {
  const name = item.displayName ?? item.sender ?? item.appLabel;
  const showTitle = item.title !== null && item.title !== '' && item.title !== name && item.title !== item.sender;
  return (
    <Row
      onPress={onPress}
      title={name}
      subtitle={
        <View style={{ gap: 2 }}>
          {showTitle && (
            <Text variant="meta" numberOfLines={1}>
              {item.title}
            </Text>
          )}
          <Text numberOfLines={3}>{item.text}</Text>
          <Text variant="caption" tone="muted">{`${item.appLabel} · ${whenLabel(item.postedAt, now)}`}</Text>
          {item.deletedBySender && <Pill label="Deleted by sender" tone="warn" />}
        </View>
      }
    />
  );
}

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
  return (
    <Screen>
      <View style={{ paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.md }}>
        <Button label="Back" variant="ghost" size="sm" onPress={onBack} />
        <Header title={title} />
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
            <ItemRow item={item} now={now} onPress={() => setSelected(item)} />
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
          if (item.senderKey !== null) setRenaming({ senderKey: item.senderKey, sender: item.sender ?? item.appLabel, name: item.displayName });
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
          load(true, null);
        }}
      />
    </Screen>
  );
}
