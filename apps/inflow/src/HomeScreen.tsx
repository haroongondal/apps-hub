import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Field, Group, Header, Notice, Row, Screen, Text } from '@apps-hub/ui';
import InflowCore, { addCapturedListener, type HomeSummary, type ItemFilter, type MoneySummary, type Status } from 'inflow-core';
import { whenLabel } from './format.ts';
import { healthNotice } from './health.ts';
import { LOAD_ERROR } from './messages.ts';
import { formatAmount, monthRange } from './money.ts';

const EMPTY_TEXT = "New notifications will appear here as they arrive. Inflow can't read ones that came before it was set up.";

function startOfToday(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function HomeScreen({
  status,
  refreshStatus,
  onOpen,
  onOpenMoney,
}: {
  status: Status;
  refreshStatus: () => void;
  onOpen: (filter: ItemFilter, title: string) => void;
  onOpenMoney: () => void;
}) {
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [money, setMoney] = useState<MoneySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    try {
      setSummary(InflowCore.home(startOfToday()));
      const now = new Date();
      const { from, to } = monthRange(now.getFullYear(), now.getMonth());
      setMoney(InflowCore.money(from, to));
      setError(null);
    } catch {
      setError(LOAD_ERROR);
    }
  }, []);

  // A failed import is not worth a message: the next open or pull tries again. New items reload Home through onCaptured.
  const importSms = useCallback(() => {
    if (!status.smsGranted) return;
    InflowCore.importSms().catch(() => {});
  }, [status.smsGranted]);

  useEffect(() => {
    load();
    importSms();
    const sub = addCapturedListener(load);
    return () => sub.remove();
  }, [load, importSms]);

  const pull = () => {
    setRefreshing(true);
    refreshStatus();
    load();
    importSms();
    setRefreshing(false);
  };

  const now = Date.now();
  const notice = healthNotice(status, now);
  const search = () => {
    const q = query.trim();
    if (q !== '') onOpen({ kind: 'search', query: q }, `Search: ${q}`);
  };
  const doAction = (action: 'access' | 'reconnect') => {
    try {
      if (action === 'access') InflowCore.openNotificationAccess();
      else InflowCore.reconnect();
    } catch {
      setError(LOAD_ERROR);
      return;
    }
    refreshStatus();
    load();
  };
  const empty = summary !== null && summary.conversations.length === 0 && summary.apps.length === 0;

  return (
    <Screen scroll refreshing={refreshing} onRefresh={pull}>
      <Header title="Inflow" />
      {error !== null && <Notice tone="danger">{error}</Notice>}
      {notice && (
        <Notice
          tone={notice.tone}
          title={notice.title}
          action={
            notice.action && <Button label={notice.action === 'access' ? 'Open notification access' : 'Reconnect'} variant="secondary" size="sm" onPress={() => doAction(notice.action!)} />
          }
        >
          {notice.body}
        </Notice>
      )}
      <Field label="Search" placeholder="Search everything you saved" value={query} onChangeText={setQuery} onSubmitEditing={search} returnKeyType="search" />
      <Group title="Money">
        {!status.smsGranted ? (
          <Row title={<Text tone="muted">Allow SMS in Settings to see your spending.</Text>} onPress={onOpenMoney} />
        ) : money === null || money.accounts.length === 0 ? (
          <Row title={<Text tone="muted">No bank messages this month.</Text>} onPress={onOpenMoney} />
        ) : (
          money.accounts.map((a) => (
            <Row
              key={`${a.account}|${a.currency}`}
              title={a.account}
              subtitle={`In ${formatAmount(a.moneyIn, a.currency)} · out ${formatAmount(a.moneyOut, a.currency)}`}
              onPress={onOpenMoney}
            />
          ))
        )}
      </Group>
      {empty && <Empty title="Nothing saved yet" body={EMPTY_TEXT} />}
      {summary !== null && !empty && (
        <Group title="Messages">
          {summary.conversations.map((r) => (
            <Row
              key={r.key}
              title={r.name}
              subtitle={
                <Text variant="meta" tone="muted" numberOfLines={1}>
                  {r.lastText}
                </Text>
              }
              onPress={() => onOpen({ kind: 'conversation', key: r.key }, r.name)}
              trailing={
                <Text variant="caption" tone="muted" align="right">
                  {r.today > 0 ? `${whenLabel(r.lastAt, now)}\n${r.today} today` : whenLabel(r.lastAt, now)}
                </Text>
              }
            />
          ))}
          <Row title="See all" onPress={() => onOpen({ kind: 'all' }, 'Everything')} />
        </Group>
      )}
      {summary !== null && summary.apps.length > 0 && (
        <Group title="Apps">
          {summary.apps.map((a) => (
            <Row
              key={a.pkg}
              title={a.label}
              subtitle={`${a.today > 0 ? `${a.today} today · ` : ''}${whenLabel(a.lastAt, now)}`}
              onPress={() => onOpen({ kind: 'app', pkg: a.pkg }, a.label)}
            />
          ))}
        </Group>
      )}
    </Screen>
  );
}
