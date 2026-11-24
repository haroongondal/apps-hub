import type { Item, Txn } from 'inflow-core';

// The words of every delete or remove confirmation, in one place so each screen asks the same way.
export interface Confirm {
  title: string;
  message: string;
  confirmLabel: string;
}

const UNDONE = 'This can’t be undone.';

export const itemName = (item: Pick<Item, 'displayName' | 'sender' | 'appLabel'>): string => item.displayName ?? item.sender ?? item.appLabel;

export const deleteItemConfirm = (): Confirm => ({
  title: 'Delete this message?',
  message: `Inflow removes it from this phone, with its summary, to-dos and saved media. ${UNDONE}`,
  confirmLabel: 'Delete',
});

export const deleteConversationConfirm = (name: string): Confirm => ({
  title: `Delete the conversation with ${name}?`,
  message: `Inflow removes every saved message from ${name}, with their summaries, to-dos and saved media. ${UNDONE}`,
  confirmLabel: 'Delete all',
});

export const txnName = (t: Pick<Txn, 'label' | 'counterparty' | 'direction'>): string => t.label ?? t.counterparty ?? (t.direction === 'in' ? 'Money in' : 'Money out');

export const deleteTxnConfirm = (): Confirm => ({
  title: 'Delete this transaction?',
  message: `Inflow removes it from your totals. The messages it came from stay saved. ${UNDONE}`,
  confirmLabel: 'Delete',
});

export const deleteTodoConfirm = (text: string): Confirm => ({ title: `Delete “${text}”?`, message: UNDONE, confirmLabel: 'Delete' });

export const removeNameConfirm = (name: string, sender: string): Confirm => ({
  title: `Remove the name ${name}?`,
  message: `Messages from ${sender} will show the sender again instead of this name.`,
  confirmLabel: 'Remove name',
});

export const keepBlockConfirm = (title: string): Confirm => ({
  title: `Send ${title} to AI again?`,
  message: 'Inflow will send new messages from it to the AI. Messages saved while it was kept stay unsent.',
  confirmLabel: 'Send to AI again',
});

export const removeGmailSenderConfirm = (sender: string): Confirm => ({
  title: `Stop downloading emails from ${sender}?`,
  message: 'Emails already saved stay. Inflow just stops fetching new ones from it.',
  confirmLabel: 'Stop downloading',
});

export const disconnectGmailConfirm = (address: string | null): Confirm => ({
  title: address === null ? 'Disconnect Gmail?' : `Disconnect ${address}?`,
  message: 'Inflow forgets the password and stops downloading emails. Saved emails and your sender list stay.',
  confirmLabel: 'Disconnect',
});
