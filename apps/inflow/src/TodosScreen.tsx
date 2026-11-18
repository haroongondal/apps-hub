import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Button, Empty, Group, Header, Notice, Pill, RecordMenu, Row, Screen, Text, space, useTheme } from '@apps-hub/ui';
import InflowCore, { addCapturedListener, type Item, type ItemFilter, type Todo } from 'inflow-core';
import { dueLabel } from './ai.ts';
import { ItemSheet } from './ItemSheet.tsx';
import { LOAD_ERROR, SAVE_ERROR } from './messages.ts';
import { itemRenameTarget } from './RecordMenus.tsx';
import { deleteTodoConfirm } from './records.ts';
import { RenameSheet, type RenameTarget } from './RenameSheet.tsx';
import { TodoSheet, type TodoTarget } from './TodoSheet.tsx';

// Every to-do, open ones first and done ones after, so a to-do marked done is never lost. Edit, mark done or not done, and delete from each row.
export function TodosScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (filter: ItemFilter, title: string) => void }) {
  const { c } = useTheme();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TodoTarget>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);

  const load = useCallback(() => {
    try {
      setTodos(InflowCore.listTodos(true));
      setError(null);
    } catch {
      setError(LOAD_ERROR);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const sub = addCapturedListener(load);
    return () => sub.remove();
  }, [load]);

  const change = (apply: () => void) => {
    try {
      apply();
    } catch {
      setError(SAVE_ERROR);
      return;
    }
    load();
  };
  const openItem = (itemId: number) => {
    if (itemId === 0) return;   // added by hand: no message behind it
    try {
      setSelected(InflowCore.getItem(itemId));
    } catch {
      setError(LOAD_ERROR);
    }
  };

  const now = Date.now();
  return (
    <Screen>
      <View style={{ paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.md }}>
        <Button label="Back" variant="ghost" size="sm" onPress={onBack} />
        <Header title="To-dos" trailing={<Button label="Add" variant="secondary" size="sm" onPress={() => setEditing('new')} />} />
      </View>
      {error !== null && (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
          <Notice tone="danger">{error}</Notice>
        </View>
      )}
      <FlatList
        style={{ backgroundColor: c.bg }}
        data={todos}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl, gap: space.md }}
        renderItem={({ item: t }) => {
          const confirm = deleteTodoConfirm(t.text);
          return (
            <Group>
              <Row
                title={<Text variant="bodyStrong" tone={t.done ? 'muted' : 'text'}>{t.text}</Text>}
                subtitle={
                  <View style={{ gap: 2 }}>
                    <Text variant="meta" tone="muted">{dueLabel(t.dueAt, now)}</Text>
                    {t.done && <Pill label="Done" tone="ok" />}
                  </View>
                }
                onPress={t.itemId === 0 ? () => setEditing(t) : () => openItem(t.itemId)}
                trailing={
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                    {!t.done && <Button label="Done" variant="secondary" size="sm" onPress={() => change(() => InflowCore.setTodoDone(t.id, true))} />}
                    <RecordMenu
                      title={t.text}
                      actions={[
                        { label: t.done ? 'Mark not done' : 'Mark done', onPress: () => change(() => InflowCore.setTodoDone(t.id, !t.done)) },
                        { label: 'Edit', onPress: () => setEditing(t) },
                        ...(t.itemId !== 0 ? [{ label: 'Open message', onPress: () => openItem(t.itemId) }] : []),
                        { label: 'Delete', onPress: () => change(() => InflowCore.deleteTodo(t.id)), destructive: true, confirmTitle: confirm.title, confirmMessage: confirm.message, confirmLabel: confirm.confirmLabel },
                      ]}
                    />
                  </View>
                }
              />
            </Group>
          );
        }}
        ListEmptyComponent={loaded && error === null ? <Empty title="No to-dos yet" body="Inflow adds to-dos it finds in your messages. You can add your own with Add." /> : null}
      />
      <TodoSheet
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
      <ItemSheet
        item={selected}
        onClose={() => setSelected(null)}
        onRename={(item) => {
          setSelected(null);
          setRenaming(itemRenameTarget(item));
        }}
        onShowSender={(name) => {
          setSelected(null);
          onOpen({ kind: 'sender', name }, name);
        }}
        onDeleted={() => {
          setSelected(null);
          load();
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
