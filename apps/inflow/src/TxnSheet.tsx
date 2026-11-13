import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Group, Notice, Row, Segmented, Sheet, Text, space } from '@apps-hub/ui';
import InflowCore, { type Item, type Txn } from 'inflow-core';
import { exactTime } from './format.ts';
import { ITEM_REMOVED, LOAD_ERROR, SAVE_ERROR } from './messages.ts';
import { formatAmount } from './money.ts';

const OWN_OPTIONS = [
  { key: 'yes', label: 'Yes' },
  { key: 'no', label: 'No' },
] as const;

export function TxnSheet({ txn, onClose, onChanged }: { txn: Txn | null; onClose: () => void; onChanged: () => void }) {
  const [own, setOwn] = useState(false);
  const [sources, setSources] = useState<Array<Item | null>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!txn) return;
    setOwn(txn.own);
    try {
      setSources(txn.itemIds.map((id) => InflowCore.getItem(id)));
      setError(null);
    } catch {
      setSources([]);
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

  return (
    <Sheet visible={txn !== null} onClose={onClose} title={txn ? formatAmount(txn.amount, txn.currency) : 'Transaction'}>
      {txn && (
        <>
          {error !== null && <Notice tone="danger">{error}</Notice>}
          <Group>
            <Row title="Direction" subtitle={txn.direction === 'in' ? 'Money in' : 'Money out'} />
            <Row title="Account" subtitle={txn.account} />
            {txn.counterparty !== null ? <Row title={txn.direction === 'in' ? 'From' : 'To'} subtitle={txn.counterparty} /> : null}
            {txn.txId !== null ? <Row title="Transaction ID" subtitle={txn.txId} mono /> : null}
            <Row title="Time" subtitle={exactTime(txn.at)} />
            <Row title="Own transfer" subtitle={txn.paired && own ? 'Matched with the other side of this transfer.' : 'Left out of your totals when set to Yes.'}>
              <Segmented accessibilityLabel="Own transfer" options={OWN_OPTIONS} value={own ? 'yes' : 'no'} onChange={choose} />
            </Row>
          </Group>
          <View style={{ gap: space.sm }}>
            {sources.map((item, i) => (
              <Text key={txn.itemIds[i]} selectable tone={item ? 'text' : 'muted'}>
                {item ? item.text : ITEM_REMOVED}
              </Text>
            ))}
          </View>
        </>
      )}
    </Sheet>
  );
}
