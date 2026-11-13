import React from 'react';
import { View } from 'react-native';
import { Button, Group, Row, Sheet, Text, space } from '@apps-hub/ui';
import type { Item } from 'inflow-core';
import { exactTime } from './format.ts';

export function ItemSheet({ item, onClose, onRename, onShowSender }: { item: Item | null; onClose: () => void; onRename: (item: Item) => void; onShowSender: (name: string) => void }) {
  const who = item ? (item.displayName ?? item.sender) : null;
  return (
    <Sheet visible={item !== null} onClose={onClose} title={item?.title ?? item?.appLabel ?? 'Notification'}>
      {item && (
        <>
          <View style={{ gap: space.sm }}>
            <Text selectable>{item.text}</Text>
          </View>
          <Group>
            <Row title="App" subtitle={item.appLabel} />
            {who !== null ? <Row title="Sender" subtitle={item.displayName !== null && item.sender !== null ? `${item.displayName} (${item.sender})` : who} /> : null}
            {item.conversation !== null ? <Row title="Conversation" subtitle={item.conversation} /> : null}
            <Row title="Received" subtitle={exactTime(item.postedAt)} />
            {item.deletedBySender ? <Row title="Status" subtitle="The sender deleted this message after Inflow saved it." /> : null}
          </Group>
          {item.senderKey !== null && <Button label="Rename sender" variant="secondary" onPress={() => onRename(item)} block />}
          {who !== null && <Button label="Show everything from this sender" variant="secondary" onPress={() => onShowSender(who)} block />}
        </>
      )}
    </Sheet>
  );
}
