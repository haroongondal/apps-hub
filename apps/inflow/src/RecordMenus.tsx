import React from 'react';
import { RecordMenu, type RecordAction } from '@apps-hub/ui';
import InflowCore, { type Item } from 'inflow-core';
import { SAVE_ERROR } from './messages.ts';
import { deleteConversationConfirm, deleteItemConfirm, itemName, type Confirm } from './records.ts';
import type { RenameTarget } from './RenameSheet.tsx';

const destructive = (label: string, c: Confirm, onPress: () => void): RecordAction => ({
  label,
  onPress,
  destructive: true,
  confirmTitle: c.title,
  confirmMessage: c.message,
  confirmLabel: c.confirmLabel,
});

export const itemRenameTarget = (item: Item): RenameTarget | null =>
  item.senderKey === null ? null : { senderKey: item.senderKey, sender: item.sender ?? item.appLabel, name: item.displayName };

// A conversation row only knows the shown name, so the saved sender name (if any) comes from the rename list.
export function conversationRenameTarget(key: string, shownName: string): RenameTarget {
  try {
    const saved = InflowCore.listSenderNames().find((n) => n.senderKey === key);
    if (saved) return { senderKey: key, sender: saved.sender, name: saved.name };
  } catch {
    // fall through: renaming still works, it just cannot offer Remove name
  }
  return { senderKey: key, sender: shownName, name: null };
}

// Three-dot menu of a message row: rename its sender, delete it (after a confirmation).
export function ItemMenu({ item, onRename, onChanged, onError }: { item: Item; onRename: (t: RenameTarget) => void; onChanged: () => void; onError: (message: string) => void }) {
  const rename = itemRenameTarget(item);
  const actions: RecordAction[] = [];
  if (rename !== null) actions.push({ label: 'Rename sender', onPress: () => onRename(rename) });
  actions.push(
    destructive('Delete', deleteItemConfirm(), () => {
      try {
        InflowCore.deleteItem(item.id);
      } catch {
        onError(SAVE_ERROR);
        return;
      }
      onChanged();
    }),
  );
  return <RecordMenu title={itemName(item)} actions={actions} />;
}

// Three-dot menu of a conversation: rename it, delete every message of it (after a confirmation).
export function ConversationMenu({
  conversationKey,
  name,
  onRename,
  onChanged,
  onError,
}: {
  conversationKey: string;
  name: string;
  onRename: (t: RenameTarget) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const actions: RecordAction[] = [
    { label: 'Rename sender', onPress: () => onRename(conversationRenameTarget(conversationKey, name)) },
    destructive('Delete conversation', deleteConversationConfirm(name), () => {
      try {
        InflowCore.deleteConversation(conversationKey);
      } catch {
        onError(SAVE_ERROR);
        return;
      }
      onChanged();
    }),
  ];
  return <RecordMenu title={name} actions={actions} />;
}
