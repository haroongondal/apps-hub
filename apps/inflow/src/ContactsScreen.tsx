import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Button, Empty, Group, Header, Notice, Row, Screen, Text, space, useTheme } from '@apps-hub/ui';
import InflowCore, { addCapturedListener, type ContactRow, type ItemFilter } from 'inflow-core';
import { startOfToday, whenLabel } from './format.ts';
import { LOAD_ERROR } from './messages.ts';

const PAGE = 50;

// One app's contacts, newest first; a contact opens its own messages in this app only.
// promo false is the main list, with a Promotions row at the end; promo true is the Promotions list itself.
export function ContactsScreen({
  title,
  pkg,
  promo,
  onBack,
  onOpen,
  onOpenPromotions,
}: {
  title: string;
  pkg: string;
  promo: boolean;
  onBack: () => void;
  onOpen: (filter: ItemFilter, title: string) => void;
  onOpenPromotions: () => void;
}) {
  const { c } = useTheme();
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [more, setMore] = useState(false);
  const [promoSenders, setPromoSenders] = useState(0);
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
        const page = InflowCore.contacts(pkg, startOfToday(), first ? null : last.lastAt, first ? null : last.key, limit, promo);
        setRows((prev) => (reset ? page : [...prev, ...page]));
        count.current = reset ? page.length : count.current + page.length;
        setMore(page.length >= limit);
        if (!promo) setPromoSenders(InflowCore.promotions(pkg).senders);
        setError(null);
      } catch {
        setError(LOAD_ERROR);
        setMore(false);
      } finally {
        busy.current = false;
        setLoaded(true);
      }
    },
    [pkg, promo],
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
          promo ? null : (
            <Group>
              <Row title="All messages" onPress={() => onOpen({ kind: 'app', pkg }, title)} />
            </Group>
          )
        }
        ListFooterComponent={
          promoSenders > 0 ? (
            <Group>
              <Row title="Promotions" subtitle={`${promoSenders} ${promoSenders === 1 ? 'sender' : 'senders'}`} onPress={onOpenPromotions} />
            </Group>
          ) : null
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
