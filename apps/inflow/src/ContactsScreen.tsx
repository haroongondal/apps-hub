import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Button, Empty, Group, Header, Notice, Row, Screen, Text, space, useTheme } from '@apps-hub/ui';
import InflowCore, { addCapturedListener, type ContactRow, type ItemFilter } from 'inflow-core';
import { whenLabel } from './format.ts';
import { LOAD_ERROR } from './messages.ts';

const PAGE = 50;

function startOfToday(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// One app's contacts, newest first; a contact opens its own messages in this app only.
export function ContactsScreen({ title, pkg, onBack, onOpen }: { title: string; pkg: string; onBack: () => void; onOpen: (filter: ItemFilter, title: string) => void }) {
  const { c } = useTheme();
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [more, setMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const count = useRef(0);

  const load = useCallback(
    (reset: boolean, last: ContactRow | null) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const limit = reset ? Math.max(PAGE, count.current) : PAGE;
        const first = reset || last === null;
        const page = InflowCore.contacts(pkg, startOfToday(), first ? null : last.lastAt, first ? null : last.key, limit);
        setRows((prev) => (reset ? page : [...prev, ...page]));
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
    [pkg],
  );

  useEffect(() => {
    load(true, null);
    const sub = addCapturedListener(() => load(true, null));
    return () => sub.remove();
  }, [load]);

  const now = Date.now();
  const last = rows.length > 0 ? rows[rows.length - 1] : null;
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
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl, gap: space.md }}
        ListHeaderComponent={
          <Group>
            <Row title="All messages" onPress={() => onOpen({ kind: 'app', pkg }, title)} />
          </Group>
        }
        renderItem={({ item }) => (
          <Group>
            <Row
              title={item.name}
              subtitle={
                <Text variant="meta" tone="muted" numberOfLines={1}>
                  {item.lastText}
                </Text>
              }
              onPress={() => onOpen({ kind: 'contact', pkg, key: item.key }, item.name)}
              trailing={
                <Text variant="caption" tone="muted" align="right">
                  {item.today > 0 ? `${whenLabel(item.lastAt, now)}\n${item.today} today` : whenLabel(item.lastAt, now)}
                </Text>
              }
            />
          </Group>
        )}
        onEndReached={() => more && last !== null && load(false, last)}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={loaded && error === null ? <Empty title="Nothing here yet" body="Messages from this app will appear here." /> : null}
      />
    </Screen>
  );
}
