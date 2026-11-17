import React from 'react';
import { View } from 'react-native';
import { Pill, Row, Text } from '@apps-hub/ui';
import type { Item } from 'inflow-core';
import { whenLabel } from './format.ts';
import { mediaCountLabel } from './media.ts';
import { itemName } from './records.ts';

// One saved message as a Row: Home's Important list and every list screen show it the same way. `menu` is the row's RecordMenu.
export function ItemRow({ item, now, onPress, menu }: { item: Item; now: number; onPress: () => void; menu?: React.ReactNode }) {
  const name = itemName(item);
  const showTitle = item.title !== null && item.title !== '' && item.title !== name && item.title !== item.sender;
  return (
    <Row
      onPress={onPress}
      title={name}
      trailing={menu}
      subtitle={
        <View style={{ gap: 2 }}>
          {showTitle && (
            <Text variant="meta" numberOfLines={1}>
              {item.title}
            </Text>
          )}
          {item.ai !== null ? (
            <>
              <Text numberOfLines={2}>{item.ai.summary}</Text>
              <Text variant="meta" tone="muted" numberOfLines={1}>
                {item.text}
              </Text>
            </>
          ) : (
            <Text numberOfLines={3}>{item.text}</Text>
          )}
          {item.mediaCount > 0 && <Pill label={mediaCountLabel(item.mediaCount)} />}
          <Text variant="caption" tone="muted">{`${item.appLabel} · ${whenLabel(item.postedAt, now)}`}</Text>
          {item.deletedBySender && <Pill label="Deleted by sender" tone="warn" />}
        </View>
      }
    />
  );
}
