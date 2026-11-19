import React, { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Button, Empty, Field, Header, Notice, Pill, RecordMenu, Row, Screen, Segmented, Text, editDeleteActions, radius, space, useTheme } from '@apps-hub/ui';
import Vault, { addSyncListener, type Row as VaultRow, type Status } from 'strongroom-vault';
import { isLocked, messageOf } from './call.ts';
import { filterRows } from './forms.ts';
import { pendingBanner } from './recovery-flow.ts';
import { SyncFooter } from './SyncScreen.tsx';
import { syncSettled } from './sync-flow.ts';
import { useEmailRecovery } from './useEmailRecovery.ts';

export interface VaultView {
  kind: VaultRow['type'];
  query: string;
}

const KINDS = [
  { key: 'login', label: 'Logins' },
  { key: 'card', label: 'Cards' },
  { key: 'note', label: 'Notes' },
  { key: 'pass', label: 'Passes' },
] as const;

const NONE: Record<VaultRow['type'], string> = { login: 'No logins yet', card: 'No cards yet', note: 'No notes yet', pass: 'No passes yet' };
const EMPTY_BODY: Record<VaultRow['type'], string> = {
  login: 'Add one, or import your logins from Google in Settings.',
  card: 'Tap Add to save a card.',
  note: 'Tap Add to save a note.',
  pass: 'Tap Add to save a ticket, membership or loyalty card as a barcode.',
};
const KIND_LABEL: Record<VaultRow['type'], string> = { login: 'Login', card: 'Card', note: 'Note', pass: 'Pass' };

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface Props {
  status: Status;
  refresh: () => void;
  view: VaultView;
  onView: (v: VaultView) => void;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onAdd: () => void;
  onOpenSync: () => void;
}

export function VaultScreen({ status, refresh, view, onView, onOpen, onEdit, onAdd, onOpenSync }: Props) {
  const { c } = useTheme();
  const [rows, setRows] = useState<VaultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recovery = useEmailRecovery();
  const [cancelling, setCancelling] = useState(false);
  const banner = pendingBanner(recovery.status, recovery.now);

  useEffect(() => {
    const load = () => {
      try {
        setRows(Vault.rows());
      } catch (e) {
        if (isLocked(e)) refresh();
        else setError(messageOf(e));
      }
    };
    load();
    // What a sync pulled shows as soon as the run ends; refresh re-reads the unreadable count too.
    const sub = addSyncListener((s) => {
      if (!syncSettled(s)) return;
      load();
      refresh();
    });
    return () => sub.remove();
  }, []);

  const dismissLostSaves = () => {
    try {
      Vault.clearLostSaves();
      refresh();
    } catch (e) {
      if (isLocked(e)) refresh();
      else setError(messageOf(e));
    }
  };

  const cancelRequest = async () => {
    setCancelling(true);
    try {
      await Vault.cancelLostRequest();
    } catch (e) {
      setError(messageOf(e));
    }
    setCancelling(false);
    void recovery.reload();
  };

  const remove = (id: string) => {
    try {
      Vault.remove(id);
      setRows(Vault.rows());
      refresh();
    } catch (e) {
      if (isLocked(e)) refresh();
      else setError(messageOf(e));
    }
  };

  const searching = view.query.trim() !== '';
  const shown = rows && (searching ? filterRows(rows, view.query) : rows.filter((r) => r.type === view.kind));
  const last = (shown?.length ?? 0) - 1;

  const header = (
    <View style={{ gap: space.xl, paddingBottom: shown && shown.length > 0 ? space.xl : 0 }}>
      <Header title="Strongroom" trailing={<Button label="Add" size="sm" onPress={onAdd} />} />
      {status.unreadable > 0 && (
        <Notice tone="warn">
          {status.unreadable === 1 ? "1 entry can't be opened. It's kept unchanged." : `${status.unreadable} entries can't be opened. They're kept unchanged.`}
        </Notice>
      )}
      {status.lostSaves > 0 && (
        <Notice
          tone="warn"
          action={
            <Button
              label="Dismiss"
              size="sm"
              variant="secondary"
              onPress={dismissLostSaves}
            />
          }
        >
          {`${count(status.lostSaves, 'saved password', 'saved passwords')} couldn't be recovered.`}
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <Field label="Search" placeholder="Search logins, cards, notes, passes" value={view.query} onChangeText={(query) => onView({ ...view, query })} autoCapitalize="none" autoCorrect={false} />
      {!searching && <Segmented options={KINDS} value={view.kind} onChange={(kind) => onView({ ...view, kind })} accessibilityLabel="Entry type" />}
      {shown && shown.length === 0 && (
        <Empty
          title={searching ? 'Nothing found' : NONE[view.kind]}
          body={searching ? 'Check the spelling, or search for a site or username.' : EMPTY_BODY[view.kind]}
        />
      )}
    </View>
  );

  const footer = (
    <View style={{ gap: space.xl, paddingTop: space.xl }}>
      {banner && (
        <Notice tone="warn" title={banner.title} action={<Button label="Cancel the request" size="sm" variant="secondary" onPress={cancelRequest} busy={cancelling} />}>
          {banner.body}
        </Notice>
      )}
      {banner && (
        <Notice tone="warn" title={banner.title} action={<Button label="Cancel the request" size="sm" variant="secondary" onPress={cancelRequest} busy={cancelling} />}>
          {banner.body}
        </Notice>
      )}
      <SyncFooter onPress={onOpenSync} />
    </View>
  );

  const renderRow = ({ item: r, index }: { item: VaultRow; index: number }) => (
    <View
      style={{
        backgroundColor: c.surface,
        borderColor: c.line,
        borderWidth: 1,
        borderTopWidth: index === 0 ? 1 : 0,
        borderBottomWidth: index === last ? 1 : 0,
        borderTopLeftRadius: index === 0 ? radius.group : 0,
        borderTopRightRadius: index === 0 ? radius.group : 0,
        borderBottomLeftRadius: index === last ? radius.group : 0,
        borderBottomRightRadius: index === last ? radius.group : 0,
        overflow: 'hidden',
      }}
    >
      {index > 0 && <View style={{ height: 1, backgroundColor: c.line, marginLeft: space.lg }} />}
      <Row
        title={r.name}
        subtitle={r.subtitle}
        leading={
          <View style={{ width: 36, height: 36, borderRadius: radius.control, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="bodyStrong" tone="accent">
              {r.name.trim().charAt(0).toUpperCase() || '?'}
            </Text>
          </View>
        }
        trailing={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            {searching && <Pill label={KIND_LABEL[r.type]} />}
            <RecordMenu title={r.name} actions={editDeleteActions({ onEdit: () => onEdit(r.id), onDelete: () => remove(r.id), noun: KIND_LABEL[r.type].toLowerCase(), name: r.name })} />
          </View>
        }
        onPress={() => onOpen(r.id)}
        accessibilityLabel={`${r.name}, ${r.subtitle}`}
      />
    </View>
  );

  return (
    <Screen>
      <FlatList
        data={shown ?? []}
        keyExtractor={(r) => r.id}
        renderItem={renderRow}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: space.lg, paddingBottom: space.xxxl, paddingHorizontal: space.lg }}
        initialNumToRender={15}
        windowSize={7}
      />
    </Screen>
  );
}
