import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Button, Empty, Group, Header, Notice, Pill, Row, Screen, Text, space, useTheme } from '@apps-hub/ui';
import InflowCore, { addCapturedListener, type MoneySummary, type Status, type Txn } from 'inflow-core';
import { whenLabel } from './format.ts';
import { LOAD_ERROR } from './messages.ts';
import { formatAmount, monthLabel, monthRange, shiftMonth, signedAmount, withinMonth } from './money.ts';
import { TxnSheet } from './TxnSheet.tsx';

const PAGE = 50;

function TxnRow({ txn, now, onPress }: { txn: Txn; now: number; onPress: () => void }) {
  return (
    <Row
      onPress={onPress}
      title={txn.counterparty ?? (txn.direction === 'in' ? 'Money in' : 'Money out')}
      subtitle={
        <View style={{ gap: 2 }}>
          <Text variant="caption" tone="muted">{`${txn.account} · ${whenLabel(txn.at, now)}`}</Text>
          {txn.own && <Pill label="Own transfer" />}
        </View>
      }
      trailing={
        <Text variant="data" tone={txn.own ? 'muted' : txn.direction === 'in' ? 'ok' : 'text'}>
          {signedAmount(txn)}
        </Text>
      }
    />
  );
}

export function MoneyScreen({ status }: { status: Status }) {
  const { c } = useTheme();
  const today = new Date();
  const [ym, setYm] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [summary, setSummary] = useState<MoneySummary | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [more, setMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Txn | null>(null);
  const busy = useRef(false);
  const raw = useRef(0);
  const range = useMemo(() => monthRange(ym.year, ym.month), [ym]);
  const isCurrent = ym.year === today.getFullYear() && ym.month === today.getMonth();

  // Pages are fetched until one holds a row from before the month, so `raw` counts rows fetched, not rows shown.
  const load = useCallback(
    (reset: boolean, last: Txn | null) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const limit = reset ? Math.max(PAGE, raw.current) : PAGE;
        const first = reset || last === null;
        const page = InflowCore.listTxns(null, first ? range.to : last.at, limit, first ? null : last.id);
        const { rows, done } = withinMonth(page, range.from, range.to);
        setTxns((prev) => (reset ? rows : [...prev, ...rows]));
        raw.current = reset ? page.length : raw.current + page.length;
        setMore(!done && page.length >= limit);
        if (reset) setSummary(InflowCore.money(range.from, range.to));
        setError(null);
      } catch {
        setError(LOAD_ERROR);
        setMore(false);
      } finally {
        busy.current = false;
        setLoaded(true);
      }
    },
    [range],
  );

  useEffect(() => {
    raw.current = 0;
    setLoaded(false);
    load(true, null);
    const sub = addCapturedListener(() => load(true, null));
    return () => sub.remove();
  }, [load]);

  const now = Date.now();
  const last = txns.length > 0 ? txns[txns.length - 1] : null;
  const move = (delta: number) => setYm((p) => shiftMonth(p.year, p.month, delta));

  const header = (
    <View style={{ gap: space.xl, paddingTop: space.lg, paddingBottom: space.lg }}>
      <Header title="Money" />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Button label="Previous" variant="ghost" size="sm" onPress={() => move(-1)} />
        <Text variant="bodyStrong">{monthLabel(ym.year, ym.month)}</Text>
        <Button label="Next" variant="ghost" size="sm" onPress={() => move(1)} disabled={isCurrent} />
      </View>
      {!status.smsGranted && <Notice>Allow SMS in Settings to see your spending.</Notice>}
      {error !== null && <Notice tone="danger">{error}</Notice>}
      {summary !== null && summary.accounts.length === 0 && error === null && <Text tone="muted">No bank messages this month.</Text>}
      {summary?.accounts.map((a) => (
        <Group key={`${a.account}|${a.currency}`} title={a.account}>
          <Row title="Money in" trailing={<Text variant="data">{formatAmount(a.moneyIn, a.currency)}</Text>} />
          <Row title="Money out" trailing={<Text variant="data">{formatAmount(a.moneyOut, a.currency)}</Text>} />
          <Row title="Transactions" trailing={<Text variant="data">{String(a.count)}</Text>} />
        </Group>
      ))}
      {summary !== null && summary.merchants.length > 0 && (
        <Group title="Where it went">
          {summary.merchants.map((m) => (
            <Row
              key={`${m.counterparty}|${m.currency}`}
              title={m.counterparty}
              subtitle={`${m.count} ${m.count === 1 ? 'payment' : 'payments'}`}
              trailing={<Text variant="data">{formatAmount(m.total, m.currency)}</Text>}
            />
          ))}
        </Group>
      )}
      {txns.length > 0 && <Text variant="caption" tone="muted">Transactions</Text>}
    </View>
  );

  return (
    <Screen>
      <FlatList
        style={{ backgroundColor: c.bg }}
        data={txns}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl, gap: space.md }}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <Group>
            <TxnRow txn={item} now={now} onPress={() => setSelected(item)} />
          </Group>
        )}
        onEndReached={() => more && last !== null && load(false, last)}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={loaded && error === null && summary !== null && summary.accounts.length > 0 ? <Empty title="No transactions" body="Transactions for this month will appear here." /> : null}
      />
      <TxnSheet txn={selected} onClose={() => setSelected(null)} onChanged={() => load(true, null)} />
    </Screen>
  );
}
