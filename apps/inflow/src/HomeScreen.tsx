import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Field, Group, Header, Notice, Row, Screen, Text } from '@apps-hub/ui';
import InflowCore, { addCapturedListener, type HomeSummary, type ItemFilter, type Status } from 'inflow-core';
import { whenLabel } from './format.ts';
import { healthNotice } from './health.ts';
import { LOAD_ERROR } from './messages.ts';

const EMPTY_TEXT = "New notifications will appear here as they arrive. Inflow can't read ones that came before it was set up.";

function startOfToday(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function HomeScreen({ status, refreshStatus, onOpen }: { status: Status; refreshStatus: () => void; onOpen: (filter: ItemFilter, title: string) => void }) {
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    try {
      setSummary(InflowCore.home(startOfToday()));
      setError(null);
    } catch {
      setError(LOAD_ERROR);
    }
  }, []);

  useEffect(() => {
    load();
    const sub = addCapturedListener(load);
    return () => sub.remove();
  }, [load]);

  const pull = () => {
    setRefreshing(true);
    refreshStatus();
    load();
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
        <Row title={<Text tone="muted">Bank SMS and spending arrive in the next update</Text>} />
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
