import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Button, Empty, Group, Header, Notice, Pill, RecordMenu, Row, Screen, Segmented, Text, space, useTheme } from '@apps-hub/ui';
import { AiErrorNotice, HubIssueNotice } from './AiHubNotice.tsx';
import { hubIssueOf } from './aiHub.ts';
import InflowCore, { addCapturedListener, type MoneySummary, type PartyTotal, type ReportRow, type Status, type Txn } from 'inflow-core';
import { Bar } from './Bar.tsx';
import { whenLabel } from './format.ts';
import { LOAD_ERROR, SAVE_ERROR } from './messages.ts';
import { formatAmount, monthLabel, monthOverview, monthRange, partySubtitle, partyTitle, shiftMonth, signedAmount, withinMonth } from './money.ts';
import { deleteTxnConfirm, txnName } from './records.ts';
import { reportTitle } from './report.ts';
import { TxnEditSheet } from './TxnEditSheet.tsx';
import { TxnSheet } from './TxnSheet.tsx';

const PAGE = 50;
const PARTIES_SHOWN = 10;
const VIEWS = [
  { key: 'overview', label: 'Overview' },
  { key: 'reports', label: 'Reports' },
  { key: 'all', label: 'All' },
] as const;
type MoneyView = (typeof VIEWS)[number]['key'];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function TxnRow({ txn, now, onPress, onEdit, onDelete }: { txn: Txn; now: number; onPress: () => void; onEdit: () => void; onDelete: () => void }) {
  const name = txnName(txn);
  const confirm = deleteTxnConfirm();
  return (
    <Row
      onPress={onPress}
      title={name}
      subtitle={
        <View style={{ gap: 2 }}>
          <Text variant="caption" tone="muted">{`${txn.account} · ${whenLabel(txn.at, now)}`}</Text>
          {txn.own && <Pill label="Own transfer" />}
          {txn.byAi && <Pill label="Read by AI" />}
        </View>
      }
      trailing={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <Text variant="data" tone={txn.own ? 'muted' : txn.direction === 'in' ? 'ok' : 'text'}>
            {signedAmount(txn)}
          </Text>
          <RecordMenu
            title={name}
            actions={[
              { label: 'Edit name', onPress: onEdit },
              { label: 'Delete', onPress: onDelete, destructive: true, confirmTitle: confirm.title, confirmMessage: confirm.message, confirmLabel: confirm.confirmLabel },
            ]}
          />
        </View>
      }
    />
  );
}

function ReportsGroup({ onOpen }: { onOpen: (r: ReportRow) => void }) {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [allowed, setAllowed] = useState(true);
  const [working, setWorking] = useState<number | 'now' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const hubIssue = reports.map((r) => hubIssueOf(r.message)).find((i) => i !== null) ?? null;

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
      {notice !== null && <AiErrorNotice text={notice} />}
      {hubIssue !== null && <HubIssueNotice issue={hubIssue} />}
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
  const [view, setView] = useState<MoneyView>('overview');
  const [allParties, setAllParties] = useState(false);
  const [editing, setEditing] = useState<Txn | null>(null);
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
  const move = (delta: number) => {
    setAllParties(false);
    setYm((p) => shiftMonth(p.year, p.month, delta));
  };
  const overviews = summary === null ? [] : monthOverview(summary);
  const manyCurrencies = overviews.length > 1;
  const parties = summary === null ? [] : allParties ? summary.parties : summary.parties.slice(0, PARTIES_SHOWN);

  const monthSwitcher = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Button label="Previous" variant="ghost" size="sm" onPress={() => move(-1)} />
      <Text variant="bodyStrong">{monthLabel(ym.year, ym.month)}</Text>
      <Button label="Next" variant="ghost" size="sm" onPress={() => move(1)} disabled={isCurrent} />
    </View>
  );

  const overview = (
    <>
      {overviews.map((o) => (
        <Group key={o.currency} title={manyCurrencies ? `${monthLabel(ym.year, ym.month)}, ${o.currency}` : monthLabel(ym.year, ym.month)}>
          <Row title="Money out" trailing={<Text variant="data">{formatAmount(o.moneyOut, o.currency)}</Text>} />
          <Row title="Money in" trailing={<Text variant="data">{formatAmount(o.moneyIn, o.currency)}</Text>} />
          <Row title="Net" trailing={<Text variant="data" tone={o.net < 0 ? 'text' : 'ok'}>{formatAmount(o.net, o.currency)}</Text>} />
          <Row title="Transactions" trailing={<Text variant="data">{String(o.count)}</Text>} />
        </Group>
      ))}
      {overviews.map(
        (o) =>
          o.categories.length > 0 && (
            <Group key={o.currency} title={manyCurrencies ? `Where it went, ${o.currency}` : 'Where it went'}>
              {o.categories.map((cat) => (
                <Row
                  key={cat.category}
                  title={cat.category}
                  subtitle={`${plural(cat.count, 'payment', 'payments')} · ${Math.round(cat.share)}%`}
                  trailing={<Text variant="data">{formatAmount(cat.total, o.currency)}</Text>}
                >
                  <Bar fraction={cat.share / 100} />
                </Row>
              ))}
            </Group>
          ),
      )}
      {summary !== null && summary.parties.length > 0 && (
        <Group title="People and shops">
          {parties.map((p) => (
            <Row key={`${p.own}|${p.name ?? ''}|${p.currency}`} title={partyTitle(p)} subtitle={partySubtitle(p)} onPress={() => onOpenParty(p)} />
          ))}
          {!allParties && summary.parties.length > PARTIES_SHOWN && <Row title="See all" subtitle={`${summary.parties.length - PARTIES_SHOWN} more`} onPress={() => setAllParties(true)} />}
        </Group>
      )}
      {summary !== null && summary.accounts.length > 0 && (
        <Group title="Accounts">
          {summary.accounts.map((a) => (
            <Row key={`${a.account}|${a.currency}`} title={a.account} subtitle={`In ${formatAmount(a.moneyIn, a.currency)} · out ${formatAmount(a.moneyOut, a.currency)}`} />
          ))}
        </Group>
      )}
    </>
  );

  const header = (
    <View style={{ gap: space.xl, paddingTop: space.lg, paddingBottom: space.lg }}>
      <Header title="Money" />
      <Segmented options={VIEWS} value={view} onChange={setView} accessibilityLabel="Money view" />
      {view !== 'reports' && monthSwitcher}
      {view === 'reports' && <ReportsGroup onOpen={onOpenReport} />}
      {view !== 'reports' && !status.smsGranted && <Notice>Allow SMS in Settings to see your spending.</Notice>}
      {view !== 'reports' && error !== null && <Notice tone="danger">{error}</Notice>}
      {view !== 'reports' && summary !== null && summary.accounts.length === 0 && error === null && <Text tone="muted">No bank messages this month.</Text>}
      {view === 'overview' && overview}
      {view === 'all' && txns.length > 0 && <Text variant="caption" tone="muted">Transactions</Text>}
    </View>
  );

  return (
    <Screen>
      <FlatList
        style={{ backgroundColor: c.bg }}
        data={view === 'all' ? txns : []}
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
        ListEmptyComponent={view === 'all' && loaded && error === null && summary !== null && summary.accounts.length > 0 ? <Empty title="No transactions" body="Transactions for this month will appear here." /> : null}
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
