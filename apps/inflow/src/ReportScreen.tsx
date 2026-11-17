import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Group, Header, Notice, Row, Screen, Text, space, useTheme } from '@apps-hub/ui';
import InflowCore, { type ReportCurrency, type ReportData, type ReportRow } from 'inflow-core';
import { LOAD_ERROR } from './messages.ts';
import { formatAmount } from './money.ts';
import { barFraction, changeLabel } from './report.ts';

const BAR = 8;
const COLUMNS = 96;

const Amount = ({ minor, currency }: { minor: number; currency: string }) => <Text variant="data">{formatAmount(minor, currency)}</Text>;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Bar({ fraction }: { fraction: number }) {
  const { c } = useTheme();
  return (
    <View style={{ height: BAR, borderRadius: BAR / 2, backgroundColor: c.accentSoft, overflow: 'hidden' }}>
      <View style={{ width: `${Math.round(fraction * 100)}%`, height: BAR, backgroundColor: c.accent }} />
    </View>
  );
}

function Categories({ title, rows, currency }: { title: string; rows: ReportCurrency['categories']; currency: string }) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.amount));
  return (
    <Group title={title}>
      {rows.map((r) => {
        const change = changeLabel(r.change);
        return (
          <Row
            key={r.name}
            title={r.name}
            subtitle={[plural(r.count, 'payment', 'payments'), `${Math.round(r.share)}%`, change].filter((s) => s !== null).join(' · ')}
            trailing={<Amount minor={r.amount} currency={currency} />}
          >
            <Bar fraction={barFraction(r.amount, max)} />
          </Row>
        );
      })}
    </Group>
  );
}

function Daily({ rows }: { rows: ReportCurrency['daily'] }) {
  const { c } = useTheme();
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((d) => d.out));
  // A month has up to 31 columns: label the first of every five so the numbers stay readable.
  const label = (i: number) => rows.length <= 7 || i % 5 === 0;
  return (
    <Group title="By day">
      <Row title="Money out each day">
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: COLUMNS }}>
          {rows.map((d) => (
            <View key={d.date} style={{ flex: 1, height: Math.max(2, barFraction(d.out, max) * COLUMNS), backgroundColor: c.accent, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 2, paddingTop: space.xs }}>
          {rows.map((d, i) => (
            <Text key={d.date} variant="caption" tone="muted" align="center" numberOfLines={1} style={{ flex: 1 }}>
              {label(i) ? String(Number(d.date.slice(8))) : ''}
            </Text>
          ))}
        </View>
      </Row>
    </Group>
  );
}

function Currency({ cur }: { cur: ReportCurrency }) {
  const k = cur.currency;
  const out = cur.categories.filter((r) => r.direction === 'out');
  const into = cur.categories.filter((r) => r.direction === 'in');
  return (
    <>
      <Group title="Totals">
        <Row title="Money in" trailing={<Amount minor={cur.totals.in} currency={k} />} />
        <Row title="Money out" trailing={<Amount minor={cur.totals.out} currency={k} />} />
        <Row title="Net" trailing={<Amount minor={cur.totals.net} currency={k} />} />
        <Row title="Transactions" trailing={<Text variant="data">{String(cur.totals.count)}</Text>} />
      </Group>
      <Categories title="Where it went" rows={out} currency={k} />
      <Categories title="Where it came from" rows={into} currency={k} />
      <Daily rows={cur.daily} />
      {cur.parties.length > 0 && (
        <Group title="People and shops">
          {cur.parties.map((p) => (
            <Row
              key={p.name}
              title={p.name}
              subtitle={[p.in > 0 ? `In ${formatAmount(p.in, k)}` : null, p.out > 0 ? `Out ${formatAmount(p.out, k)}` : null, plural(p.count, 'transaction', 'transactions')].filter((s) => s !== null).join(' · ')}
            />
          ))}
        </Group>
      )}
      {cur.accounts.length > 0 && (
        <Group title="Accounts">
          {cur.accounts.map((a) => (
            <Row
              key={a.name}
              title={a.name}
              subtitle={[`In ${formatAmount(a.in, k)}`, `Out ${formatAmount(a.out, k)}`, plural(a.count, 'transaction', 'transactions')].join(' · ')}
            />
          ))}
        </Group>
      )}
      {(cur.own.in > 0 || cur.own.out > 0 || cur.own.transfers.length > 0) && (
        <Group title="Between your accounts" footer="These are left out of the totals above.">
          <Row title="Moved in" trailing={<Amount minor={cur.own.in} currency={k} />} />
          <Row title="Moved out" trailing={<Amount minor={cur.own.out} currency={k} />} />
          {cur.own.transfers.map((t, i) => (
            <Row key={`${t.date}|${i}`} title={`${t.from} to ${t.to}`} subtitle={t.date} trailing={<Amount minor={t.amount} currency={k} />} />
          ))}
        </Group>
      )}
      {cur.largest.length > 0 && (
        <Group title="Largest payments">
          {cur.largest.map((l, i) => (
            <Row key={`${l.date}|${i}`} title={l.name} subtitle={`${l.date} · ${l.category}`} trailing={<Amount minor={l.amount} currency={k} />} />
          ))}
        </Group>
      )}
      <Group title="Fees and cash">
        <Row title="Fees and charges" subtitle={plural(cur.fees.count, 'charge', 'charges')} trailing={<Amount minor={cur.fees.amount} currency={k} />} />
        <Row title="Cash withdrawn" subtitle={plural(cur.cash.count, 'withdrawal', 'withdrawals')} trailing={<Amount minor={cur.cash.amount} currency={k} />} />
      </Group>
    </>
  );
}

// One stored report: totals, charts and tables per currency, then what the AI noticed.
export function ReportScreen({ id, title, onBack }: { id: number; title: string; onBack: () => void }) {
  const [row, setRow] = useState<ReportRow | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const r = InflowCore.getReport(id);
      setRow(r?.row ?? null);
      setData(r?.data ?? null);
      setError(r === null ? 'This report is no longer saved.' : null);
    } catch {
      setError(LOAD_ERROR);
    }
  }, [id]);

  return (
    <Screen scroll>
      <View style={{ gap: space.sm }}>
        <Button label="Back" variant="ghost" size="sm" onPress={onBack} />
        <Header title={title} />
      </View>
      {error !== null && <Notice tone="danger">{error}</Notice>}
      {error === null && data === null && <Notice>{row?.message ?? 'This report is not ready yet.'}</Notice>}
      {data?.currencies.map((cur) => (
        <React.Fragment key={cur.currency}>
          {data.currencies.length > 1 && <Text variant="heading">{cur.currency}</Text>}
          <Currency cur={cur} />
        </React.Fragment>
      ))}
      {data !== null && data.insights.length > 0 && (
        <Group title="What stands out">
          {data.insights.map((s, i) => (
            <Row key={i} title={<Text>{s}</Text>} />
          ))}
        </Group>
      )}
    </Screen>
  );
}
