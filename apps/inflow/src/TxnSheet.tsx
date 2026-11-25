import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Group, Notice, Row, Segmented, Sheet, Text, confirmAction, space } from '@apps-hub/ui';
import InflowCore, { type Item, type Txn } from 'inflow-core';
import { exactTime } from './format.ts';
import { ITEM_REMOVED, LOAD_ERROR, SAVE_ERROR } from './messages.ts';
import { formatAmount } from './money.ts';
import { deleteTxnConfirm } from './records.ts';
import { MediaGroup } from './ItemSheet.tsx';
import { ReceiptSheet } from './ReceiptSheet.tsx';

// The saved messages of a payment that carry a photo.
const withPhoto = (t: Txn): number[] => t.itemIds.filter((id) => InflowCore.mediaFor(id).some((m) => m.kind === 'image'));

const OWN_OPTIONS = [
  { key: 'yes', label: 'Yes' },
  { key: 'no', label: 'No' },
] as const;

export function TxnSheet({
  txn,
  onClose,
  onChanged,
  onEdit,
  onDeleted,
}: {
  txn: Txn | null;
  onClose: () => void;
  onChanged: () => void;
  // Opens the edit sheet for this transaction; the caller closes this one.
  onEdit: (txn: Txn) => void;
  // Called after the transaction was deleted; the caller closes this sheet and reloads.
  onDeleted: () => void;
}) {
  const [own, setOwn] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [categorySet, setCategorySet] = useState(false);
  const [choices, setChoices] = useState<string[] | null>(null);
  const [sources, setSources] = useState<Array<Item | null>>([]);
  const [error, setError] = useState<string | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [photoIds, setPhotoIds] = useState<number[]>([]);
  const [photoRev, setPhotoRev] = useState(0);   // a new photo on the same message needs a fresh read

  useEffect(() => {
    if (!txn) return;
    setOwn(txn.own);
    setCategory(txn.category);
    setCategorySet(txn.categorySet);
    setChoices(null);
    try {
      setSources(txn.itemIds.map((id) => InflowCore.getItem(id)));
      setPhotoIds(withPhoto(txn));
      setError(null);
    } catch {
      setSources([]);
      setPhotoIds([]);
      setError(LOAD_ERROR);
    }
  }, [txn?.id]);

  const choose = (key: 'yes' | 'no') => {
    if (!txn) return;
    const next = key === 'yes';
    try {
      InflowCore.setOwnTransfer(txn.id, next);
    } catch {
      setError(SAVE_ERROR);
      return;
    }
    setOwn(next);
    setError(null);
    onChanged();
  };

  const openChoices = () => {
    if (!txn) return;
    try {
      const all = InflowCore.categories();
      setChoices(txn.direction === 'in' ? all.in : all.out);
      setError(null);
    } catch {
      setError(LOAD_ERROR);
    }
  };

  // null hands the choice back to the AI; the owner's pick is kept and never overwritten.
  const pick = (next: string | null) => {
    if (!txn) return;
    if (next === null && !categorySet) {   // already the AI's: clearing would drop its category and pay to ask again
      setChoices(null);
      return;
    }
    try {
      InflowCore.setCategory(txn.id, next);
    } catch {
      setError(SAVE_ERROR);
      return;
    }
    setCategory(next);
    setCategorySet(next !== null);
    setChoices(null);
    setError(null);
    onChanged();
  };

  const askDelete = () => {
    if (!txn) return;
    const c = deleteTxnConfirm();
    confirmAction({
      title: c.title,
      message: c.message,
      confirmLabel: c.confirmLabel,
      onConfirm: () => {
        try {
          InflowCore.deleteTxn(txn.id);
        } catch {
          setError(SAVE_ERROR);
          return;
        }
        onDeleted();
      },
    });
  };

  return (
    <>
    <Sheet visible={txn !== null} onClose={onClose} title={txn ? formatAmount(txn.amount, txn.currency) : 'Transaction'}>
      {txn && (
        <>
          {error !== null && <Notice tone="danger">{error}</Notice>}
          <Group>
            <Row title="Direction" subtitle={txn.direction === 'in' ? 'Money in' : 'Money out'} />
            <Row title="Account" subtitle={txn.account} />
            {txn.counterparty !== null ? <Row title={txn.direction === 'in' ? 'From' : 'To'} subtitle={txn.counterparty} /> : null}
            {txn.label !== null ? <Row title="Clean name" subtitle={txn.label} /> : null}
            <Row
              title="Category"
              subtitle={category === null ? 'Not chosen yet' : categorySet ? `${category} · Set by you` : category}
              onPress={choices === null ? openChoices : () => setChoices(null)}
              accessibilityHint="Choose a category"
            />
            {txn.byAi ? <Row title="Source" subtitle="Read by AI from the message text. It counts in your totals." /> : null}
            {txn.txId !== null ? <Row title="Transaction ID" subtitle={txn.txId} mono /> : null}
            <Row title="Time" subtitle={exactTime(txn.at)} />
            <Row title="Own transfer" subtitle={txn.paired && own ? 'Matched with the other side of this transfer.' : 'Left out of your totals when set to Yes.'}>
              <Segmented accessibilityLabel="Own transfer" options={OWN_OPTIONS} value={own ? 'yes' : 'no'} onChange={choose} />
            </Row>
            {txn.itemIds.length > 0 ? (
              <Row title="Receipt" subtitle={photoIds.length > 0 ? "A receipt photo is saved with this payment. Tap to look for another." : "Find a photo from around this date that shows this amount"} onPress={() => setReceiptOpen(true)} />
            ) : null}
          </Group>
          {choices !== null && (
            <Group title="Choose a category">
              <Row title="Let the AI choose" onPress={() => pick(null)} trailing={!categorySet ? <Text variant="meta" tone="accent">Selected</Text> : undefined} />
              {choices.map((name) => (
                <Row key={name} title={name} onPress={() => pick(name)} trailing={categorySet && category === name ? <Text variant="meta" tone="accent">Selected</Text> : undefined} />
              ))}
            </Group>
          )}
          {photoIds.map((id) => <MediaGroup key={`${id}:${photoRev}`} itemId={id} title="Receipt" />)}
          <View style={{ gap: space.sm }}>
            {sources.map((item, i) => (
              <Text key={txn.itemIds[i]} selectable tone={item ? 'text' : 'muted'}>
                {item ? item.text : ITEM_REMOVED}
              </Text>
            ))}
          </View>
          <Button label="Edit name" variant="secondary" onPress={() => onEdit(txn)} block />
          <Button label="Delete transaction" variant="danger" onPress={askDelete} block />
        </>
      )}
    </Sheet>
    <ReceiptSheet txn={receiptOpen ? txn : null} onClose={() => setReceiptOpen(false)} onAttached={() => {
      try {
        if (txn) setPhotoIds(withPhoto(txn));
      } catch {
        setError(LOAD_ERROR);
      }
      setPhotoRev((n) => n + 1);
      onChanged();
    }} />
    </>
  );
}
