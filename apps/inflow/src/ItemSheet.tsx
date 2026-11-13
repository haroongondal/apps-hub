import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Group, Notice, Row, Sheet, Text, space } from '@apps-hub/ui';
import InflowCore, { type Item } from 'inflow-core';
import { importanceLabel, kindLabel } from './ai.ts';
import { exactTime } from './format.ts';
import { SAVE_ERROR } from './messages.ts';

export function ItemSheet({ item, onClose, onRename, onShowSender }: { item: Item | null; onClose: () => void; onRename: (item: Item) => void; onShowSender: (name: string) => void }) {
  const who = item ? (item.displayName ?? item.sender) : null;
  const [kept, setKept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const senderKey = item?.senderKey ?? null;
  useEffect(() => {
    try {
      setKept(senderKey !== null && InflowCore.listAiBlocks().includes(`sender:${senderKey}`));
    } catch {
      setKept(false);
    }
    setError(null);
  }, [senderKey]);
  const toggleKept = () => {
    if (senderKey === null) return;
    try {
      InflowCore.setAiBlocked(`sender:${senderKey}`, !kept);
      setKept(!kept);
      setError(null);
    } catch {
      setError(SAVE_ERROR);
    }
  };
  return (
    <Sheet visible={item !== null} onClose={onClose} title={item?.title ?? item?.appLabel ?? 'Notification'}>
      {item && (
        <>
          <View style={{ gap: space.sm }}>
            <Text selectable>{item.text}</Text>
          </View>
          {item.emailText !== null && (
            <Group title="Full email">
              <Row title={<Text selectable>{item.emailText}</Text>} />
            </Group>
          )}
          {item.ai !== null && (
            <Group title="Read by AI">
              <Row title="Summary" subtitle={item.ai.summary} />
              <Row title="Kind" subtitle={kindLabel(item.ai.kind)} />
              <Row title="Importance" subtitle={importanceLabel(item.ai.importance)} />
              {item.ai.tags.length > 0 ? <Row title="Suggested tags" subtitle={item.ai.tags.join(', ')} /> : null}
            </Group>
          )}
          <Group>
            <Row title="App" subtitle={item.appLabel} />
            {who !== null ? <Row title="Sender" subtitle={item.displayName !== null && item.sender !== null ? `${item.displayName} (${item.sender})` : who} /> : null}
            {item.conversation !== null ? <Row title="Conversation" subtitle={item.conversation} /> : null}
            <Row title="Received" subtitle={exactTime(item.postedAt)} />
            {item.deletedBySender ? <Row title="Status" subtitle="The sender deleted this message after Inflow saved it." /> : null}
          </Group>
          {item.senderKey !== null && <Button label="Rename sender" variant="secondary" onPress={() => onRename(item)} block />}
          {error !== null && <Notice tone="danger">{error}</Notice>}
          {senderKey !== null && <Button label={kept ? 'Send this sender to AI again' : "Don't send this sender to AI"} variant="secondary" onPress={toggleKept} block />}
          {who !== null && <Button label="Show everything from this sender" variant="secondary" onPress={() => onShowSender(who)} block />}
        </>
      )}
    </Sheet>
  );
}
