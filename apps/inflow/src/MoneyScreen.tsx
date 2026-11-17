import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Button, Empty, Group, Header, Notice, Pill, Row, Screen, Text, space, useTheme } from '@apps-hub/ui';
import InflowCore, { addCapturedListener, type MoneySummary, type PartyTotal, type ReportRow, type Status, type Txn } from 'inflow-core';
import { whenLabel } from './format.ts';
import { LOAD_ERROR, SAVE_ERROR } from './messages.ts';
import { formatAmount, monthLabel, monthRange, partySubtitle, partyTitle, shiftMonth, signedAmount, withinMonth } from './money.ts';
import { reportTitle } from './report.ts';
import { TxnSheet } from './TxnSheet.tsx';

const PAGE = 50;

export function TxnRow({ txn, now, onPress }: { txn: Txn; now: number; onPress: () => void }) {
  return (
    <Row
      onPress={onPress}
      title={txn.label ?? txn.counterparty ?? (txn.direction === 'in' ? 'Money in' : 'Money out')}
      subtitle={
        <View style={{ gap: 2 }}>
          <Text variant="caption" tone="muted">{`${txn.account} · ${whenLabel(txn.at, now)}`}</Text>
          {txn.own && <Pill label="Own transfer" />}
          {txn.byAi && <Pill label="Read by AI" />}
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

function ReportsGroup({ onOpen }: { onOpen: (r: ReportRow) => void }) {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [allowed, setAllowed] = useState(true);
  const [working, setWorking] = useState<number | 'now' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    try {
      setReports(InflowCore.listReports());
      setAllowed(InflowCore.notificationsAllowed());
    } catch {
      setNotice(LOAD_ERROR);
    }
  }, []);
  useEffect(load, [load]);

  const run = async (key: number | 'now', job: () => Promise<{ ok: boolean; message: string | null }>) => {
    setWorking(key);
    try {
      const r = await job();
      setNotice(r.ok ? null : (r.message ?? "Inflow couldn't make the report. Try again in a few minutes."));
    } catch {
      setNotice("Inflow couldn't make the report. Try again in a few minutes.");
    }
    setWorking(null);
    load();
  };
  const ask = async () => {
    try {
      await InflowCore.askNotifications();
    } catch {
      setNotice(SAVE_ERROR);
    }
    load();
  };

  return (
    <View style={{ gap: space.md }}>
      <Group title="Reports">
        {reports.length === 0 && <Row title="No reports yet" subtitle="Inflow makes one every Sunday night and one at the start of each month." />}
        {reports.map((r) => (
          <Row
            key={r.id}
            title={reportTitle(r)}
            subtitle={
              r.status === 'ready' ? (r.headline ?? undefined) : (
                <Text variant="meta" tone={r.status === 'failed' ? 'warn' : 'muted'}>
                  {r.message ?? (r.status === 'waiting' ? "Waiting for tomorrow's AI limit." : "Couldn't make this report.")}
                </Text>
              )
            }
            onPress={r.status === 'ready' ? () => onOpen(r) : undefined}
            trailing={r.status === 'failed' ? <Button label="Try again" size="sm" variant="secondary" busy={working === r.id} disabled={working !== null} onPress={() => run(r.id, () => InflowCore.retryReport(r.id))} /> : undefined}
          />
        ))}
        {!allowed && <Row title="Get a notification when a report is ready" onPress={ask} />}
      </Group>
      {notice !== null && <Notice tone="danger">{notice}</Notice>}
      <Button label="Make a report now" variant="secondary" busy={working === 'now'} disabled={working !== null} onPress={() => run('now', () => InflowCore.makeReportNow())} />
    </View>
  );
}

export function MoneyScreen({ status, onOpenParty, onOpenReport }: { status: Status; onOpenParty: (p: PartyTotal) => void; onOpenReport: (r: ReportRow) => void }) {
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
      <ReportsGroup onOpen={onOpenReport} />
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
      {summary !== null && summary.categories.length > 0 && (
        <Group title="By category">
          {summary.categories.map((cat) => (
            <Row
              key={`${cat.category}|${cat.currency}`}
              title={cat.category}
              subtitle={`${cat.count} ${cat.count === 1 ? 'payment' : 'payments'}`}
              trailing={<Text variant="data">{formatAmount(cat.total, cat.currency)}</Text>}
            />
          ))}
        </Group>
      )}
      {summary !== null && summary.parties.length > 0 && (
        <Group title="People and shops">
          {summary.parties.map((p) => (
            <Row key={`${p.own}|${p.name ?? ''}|${p.currency}`} title={partyTitle(p)} subtitle={partySubtitle(p)} onPress={() => onOpenParty(p)} />
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
