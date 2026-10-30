import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Empty, Field, Group, Header, Notice, Pill, Row, Screen, Segmented, Text, radius, useTheme } from '@apps-hub/ui';
import Vault, { type Row as VaultRow, type Status } from 'strongroom-vault';
import { isLocked, messageOf } from './call.ts';
import { filterRows } from './forms.ts';

export interface VaultView {
  kind: VaultRow['type'];
  query: string;
}

const KINDS = [
  { key: 'login', label: 'Logins' },
  { key: 'card', label: 'Cards' },
  { key: 'note', label: 'Notes' },
] as const;

const NONE: Record<VaultRow['type'], string> = { login: 'No logins yet', card: 'No cards yet', note: 'No notes yet' };
const EMPTY_BODY: Record<VaultRow['type'], string> = {
  login: 'Add one, or import your logins from Google in Settings.',
  card: 'Tap Add to save a card.',
  note: 'Tap Add to save a note.',
};
const KIND_LABEL: Record<VaultRow['type'], string> = { login: 'Login', card: 'Card', note: 'Note' };

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface Props {
  status: Status;
  refresh: () => void;
  view: VaultView;
  onView: (v: VaultView) => void;
  onOpen: (id: string) => void;
  onAdd: () => void;
}

export function VaultScreen({ status, refresh, view, onView, onOpen, onAdd }: Props) {
  const { c } = useTheme();
  const [rows, setRows] = useState<VaultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setRows(Vault.rows());
    } catch (e) {
      if (isLocked(e)) refresh();
      else setError(messageOf(e));
    }
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

  const searching = view.query.trim() !== '';
  const shown = rows && (searching ? filterRows(rows, view.query) : rows.filter((r) => r.type === view.kind));

  return (
    <Screen scroll>
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
      <Field label="Search" placeholder="Search logins, cards, notes" value={view.query} onChangeText={(query) => onView({ ...view, query })} autoCapitalize="none" autoCorrect={false} />
      {!searching && <Segmented options={KINDS} value={view.kind} onChange={(kind) => onView({ ...view, kind })} accessibilityLabel="Entry type" />}
      {shown && shown.length === 0 && (
        <Empty
          title={searching ? 'Nothing found' : NONE[view.kind]}
          body={searching ? 'Check the spelling, or search for a site or username.' : EMPTY_BODY[view.kind]}
        />
      )}
      {shown && shown.length > 0 && (
        <Group>
          {shown.map((r) => (
            <Row
              key={r.id}
              title={r.name}
              subtitle={r.subtitle}
              leading={
                <View style={{ width: 36, height: 36, borderRadius: radius.control, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Text variant="bodyStrong" tone="accent">
                    {r.name.trim().charAt(0).toUpperCase() || '?'}
                  </Text>
                </View>
              }
              trailing={searching ? <Pill label={KIND_LABEL[r.type]} /> : undefined}
              onPress={() => onOpen(r.id)}
              accessibilityLabel={`${r.name}, ${r.subtitle}`}
            />
          ))}
        </Group>
      )}
    </Screen>
  );
}
