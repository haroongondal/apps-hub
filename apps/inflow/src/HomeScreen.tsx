import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Empty, Field, Group, Header, Notice, Readout, Row, Screen, Text, space } from '@apps-hub/ui';
import InflowCore, { addCapturedListener, type HomeSummary, type Item, type ItemFilter, type MoneySummary, type Status } from 'inflow-core';
import { dueLabel } from './ai.ts';
import { Bar } from './Bar.tsx';
import { startOfToday, whenLabel } from './format.ts';
import { ItemSheet } from './ItemSheet.tsx';
import { healthNotice } from './health.ts';
import { LOAD_ERROR, SAVE_ERROR } from './messages.ts';
import { formatAmount, monthOverview, monthRange } from './money.ts';
import { RenameSheet, type RenameTarget } from './RenameSheet.tsx';

const EMPTY_TEXT = "New notifications will appear here as they arrive. Inflow can't read ones that came before it was set up.";

export function HomeScreen({
  status,
  refreshStatus,
  onOpen,
  onOpenContacts,
  onOpenMoney,
  onOpenApps,
}: {
  status: Status;
  refreshStatus: () => void;
  onOpen: (filter: ItemFilter, title: string) => void;
  onOpenContacts: (pkg: string, title: string) => void;
  onOpenMoney: () => void;
  onOpenApps: () => void;
}) {
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [money, setMoney] = useState<MoneySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Item | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);

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

  // Only when signed in; Settings shows any error.
  const syncGmail = useCallback(() => {
    try {
      if (InflowCore.gmailStatus().address === null) return;
    } catch {
      return;
    }
    InflowCore.syncGmail().catch(() => {});
  }, []);

  useEffect(() => {
    load();
    importSms();
    syncGmail();
    const sub = addCapturedListener(load);
    return () => sub.remove();
  }, [load, importSms, syncGmail]);

  const pull = () => {
    setRefreshing(true);
    refreshStatus();
    load();
    importSms();
    syncGmail();
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
  const finishTodo = (id: number) => {
    try {
      InflowCore.setTodoDone(id, true);
    } catch {
      setError(SAVE_ERROR);
      return;
    }
    load();
  };
  const openTodoItem = (itemId: number) => {
    try {
      setSelected(InflowCore.getItem(itemId));
    } catch {
      setError(LOAD_ERROR);
    }
  };
  const empty = summary !== null && !summary.hasItems;
  // The card shows one currency (PKR is the only one so far).
  const overview = money === null ? null : (monthOverview(money)[0] ?? null);

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
        ) : overview === null ? (
          <Row title={<Text tone="muted">No bank messages this month.</Text>} onPress={onOpenMoney} />
        ) : (
          <Row
            title={
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xl }}>
                <Readout label="Out this month" value={formatAmount(overview.moneyOut, overview.currency)} />
                <Readout label="In this month" value={formatAmount(overview.moneyIn, overview.currency)} tone="ok" />
              </View>
            }
            onPress={onOpenMoney}
          >
            {overview.categories.slice(0, 3).map((cat) => (
              <View key={cat.category} style={{ gap: space.xs }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text variant="meta">{cat.category}</Text>
                  <Text variant="meta" tone="muted">{`${Math.round(cat.share)}%`}</Text>
                </View>
                <Bar fraction={cat.share / 100} />
              </View>
            ))}
          </Row>
        )}
      </Group>
      {summary !== null && summary.inbox.length > 0 && (
        <Group title="Inbox">
          {summary.inbox.map((a) => (
            <Row
              key={a.pkgs[0]}
              title={a.label}
              subtitle={a.today > 0 ? `${a.today} today` : whenLabel(a.lastAt, now)}
              onPress={() => onOpenContacts(a.pkgs[0], a.label)}
            />
          ))}
        </Group>
      )}
      {summary !== null && summary.important.length > 0 && (
        <Group title="Important">
          {summary.important.map((i) => (
            <Row
              key={i.id}
              title={i.displayName ?? i.sender ?? i.appLabel}
              subtitle={
                <View style={{ gap: 2 }}>
                  <Text numberOfLines={2}>{i.ai?.summary ?? i.text}</Text>
                  <Text variant="caption" tone="muted">{`${i.appLabel} · ${whenLabel(i.postedAt, now)}`}</Text>
                </View>
              }
              onPress={() => setSelected(i)}
            />
          ))}
        </Group>
      )}
      {summary !== null && (
        <Group title="Coming up">
          {summary.comingUp.length === 0 ? (
            <Row title={<Text tone="muted">Nothing coming up.</Text>} />
          ) : (
            summary.comingUp.map((t) => (
              <Row
                key={t.id}
                title={t.text}
                subtitle={dueLabel(t.dueAt, now)}
                onPress={() => openTodoItem(t.itemId)}
                trailing={<Button label="Done" variant="secondary" size="sm" onPress={() => finishTodo(t.id)} />}
              />
            ))
          )}
        </Group>
      )}
      {empty && <Empty title="Nothing saved yet" body={EMPTY_TEXT} />}
      {summary !== null && summary.hasItems && (
        <Group title="Recent chats">
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
      {summary !== null && summary.hasItems && (
        <Group title="All apps">
          <Row title="See every app" onPress={onOpenApps} />
        </Group>
      )}
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
          load();
        }}
      />
    </Screen>
  );
}
