import { snippetParts, type Folder, type Item, type ItemKind } from '@apps-hub/library-core';
import { fonts, Group, RecordMenu, Row, Text, useTheme, type RecordAction } from '@apps-hub/ui';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { View } from 'react-native';

import { describeItem, plural } from './format';
import type { IconName } from './icon-button';
import { itemFile } from './paths';

const KIND_ICON: Record<ItemKind, IconName> = {
  pdf: 'document-text-outline',
  scan: 'scan-outline',
  article: 'newspaper-outline',
};

function Thumb({ item }: { item: Item }) {
  const { c } = useTheme();
  const thumb = itemFile(item.id, 'thumb.jpg');
  return (
    <View style={{ width: 40, height: 52, borderRadius: 4, overflow: 'hidden', backgroundColor: c.raised, alignItems: 'center', justifyContent: 'center' }}>
      {thumb.exists ? (
        <Image source={{ uri: thumb.uri }} style={{ width: 40, height: 52 }} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : (
        <Ionicons name={KIND_ICON[item.kind]} size={22} color={c.muted} />
      )}
    </View>
  );
}

function Snippet({ snippet }: { snippet: string }) {
  return (
    <Text variant="meta" tone="muted" numberOfLines={2}>
      {snippetParts(snippet).map((part, i) =>
        part.hit ? (
          <Text key={i} variant="meta" style={{ fontFamily: fonts.semibold }}>
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

export function FolderRow({
  folder,
  onOpen,
  actions,
}: {
  folder: Folder;
  onOpen: () => void;
  actions: RecordAction[];
}) {
  const { c } = useTheme();
  const count = plural(folder.itemCount, 'item');
  return (
    <Group>
      <Row
        title={folder.name}
        subtitle={count}
        leading={<Ionicons name="folder-outline" size={32} color={c.accent} />}
        trailing={<RecordMenu title={folder.name} actions={actions} />}
        onPress={onOpen}
        accessibilityLabel={`Folder ${folder.name}, ${count}`}
      />
    </Group>
  );
}

export function ItemRow({
  item,
  snippet,
  where,
  onOpen,
  actions,
}: {
  item: Item;
  snippet: string | null;
  where: string | null;
  onOpen: () => void;
  actions: RecordAction[];
}) {
  const subtitle = where ? `${describeItem(item)} · in ${where}` : describeItem(item);
  return (
    <Group>
      <Row
        title={item.title}
        subtitle={subtitle}
        leading={<Thumb item={item} />}
        trailing={<RecordMenu title={item.title} actions={actions} />}
        onPress={onOpen}
        accessibilityLabel={`${item.title}, ${subtitle}`}
      >
        {snippet ? <Snippet snippet={snippet} /> : null}
      </Row>
    </Group>
  );
}
