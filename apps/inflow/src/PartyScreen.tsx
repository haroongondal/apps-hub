import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Button, Empty, Group, Header, Notice, Row, Screen, Text, space, useTheme } from '@apps-hub/ui';
import InflowCore, { addCapturedListener, type Txn } from 'inflow-core';
import { LOAD_ERROR, SAVE_ERROR } from './messages.ts';
import { formatAmount } from './money.ts';
import { TxnRow } from './MoneyScreen.tsx';
import { TxnEditSheet } from './TxnEditSheet.tsx';
import { TxnSheet } from './TxnSheet.tsx';

const PAGE = 50;

type Totals = ReturnType<typeof InflowCore.partyTotals>;

// Every transaction with one person or shop (or between the owner's own accounts), all months, newest first.
export function PartyScreen({ title, name, own, onBack }: { title: string; name: string | null; own: boolean; onBack: () => void }) {
  const { c } = useTheme();
  const [totals, setTotals] = useState<Totals>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [more, setMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Txn | null>(null);
  const [editing, setEditing] = useState<Txn | null>(null);
  const busy = useRef(false);
  const count = useRef(0);

  const load = useCallback(
    (reset: boolean, last: Txn | null) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const limit = reset ? Math.max(PAGE, count.current) : PAGE;
        const first = reset || last === null;
        const page = InflowCore.listPartyTxns(name, own, first ? null : last.at, limit, first ? null : last.id);
        setTxns((prev) => (reset ? page : [...prev, ...page]));
        count.current = reset ? page.length : count.current + page.length;
        setMore(page.length >= limit);
        if (reset) setTotals(InflowCore.partyTotals(name, own));
        setError(null);
      } catch {
        setError(LOAD_ERROR);
        setMore(false);
      } finally {
        busy.current = false;
        setLoaded(true);
      }
    },
    [name, own],
  );

  useEffect(() => {
    load(true, null);
    const sub = addCapturedListener(() => load(true, null));
    return () => sub.remove();
  }, [load]);

  const remove = (txn: Txn) => {
    try {
      InflowCore.deleteTxn(txn.id);
    } catch {
      setError(SAVE_ERROR);
      return;
    }
    load(true, null);
  };

  const now = Date.now();
  const last = txns.length > 0 ? txns[txns.length - 1] : null;
  const header = (
    <View style={{ gap: space.xl, paddingBottom: space.lg }}>
      {totals.map((t) => (
        <Group key={t.currency} title="All time">
          <Row title="Money in" trailing={<Text variant="data">{formatAmount(t.moneyIn, t.currency)}</Text>} />
          <Row title="Money out" trailing={<Text variant="data">{formatAmount(t.moneyOut, t.currency)}</Text>} />
          <Row title="Transactions" trailing={<Text variant="data">{String(t.count)}</Text>} />
        </Group>
      ))}
    </View>
  );

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
        data={txns}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl, gap: space.md }}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <Group>
            <TxnRow txn={item} now={now} onPress={() => setSelected(item)} onEdit={() => setEditing(item)} onDelete={() => remove(item)} />
          </Group>
        )}
        onEndReached={() => more && last !== null && load(false, last)}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={loaded && error === null ? <Empty title="No transactions" body="Transactions with them will appear here." /> : null}
      />
      <TxnSheet
        txn={selected}
        onClose={() => setSelected(null)}
        onChanged={() => load(true, null)}
        onEdit={(t) => {
          setSelected(null);
          setEditing(t);
        }}
        onDeleted={() => {
          setSelected(null);
          load(true, null);
        }}
      />
      <TxnEditSheet
        txn={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load(true, null);
        }}
      />
    </Screen>
  );
}
