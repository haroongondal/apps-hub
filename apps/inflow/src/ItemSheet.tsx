import React, { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { Button, Group, Notice, Row, Sheet, Text, radius, space } from '@apps-hub/ui';
import InflowCore, { type Item, type MediaInfo } from 'inflow-core';
import { importanceLabel, kindLabel } from './ai.ts';
import { exactTime } from './format.ts';
import { mediaKindLabel, sizeLabel } from './media.ts';
import { SAVE_ERROR } from './messages.ts';

const OPEN_ERROR = 'This file could not be opened.';
const INLINE_MAX = 8 * 1024 * 1024;   // as readMedia allows in Kotlin
const inline = (m: MediaInfo) => (m.kind === 'image' || m.kind === 'sticker') && m.size <= INLINE_MAX;

function MediaGroup({ itemId }: { itemId: number }) {
  const [files, setFiles] = useState<MediaInfo[]>([]);
  const [pictures, setPictures] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setPictures({});
    setError(null);
    let list: MediaInfo[] = [];
    try {
      list = InflowCore.mediaFor(itemId);
    } catch {
      setError(OPEN_ERROR);
    }
    setFiles(list);
    const next: Record<number, string> = {};
    for (const m of list.filter(inline)) {
      try {
        next[m.id] = `data:${m.mime};base64,${InflowCore.readMedia(m.id)}`;
      } catch {
        setError(OPEN_ERROR);
      }
    }
    setPictures(next);
  }, [itemId]);
  const open = (id: number) => {
    try {
      InflowCore.openMedia(id);
      setError(null);
    } catch {
      setError(OPEN_ERROR);
    }
  };
  return (
    <>
      <Group title="Media">
        {files.map((m) =>
          pictures[m.id] !== undefined ? (
            <View key={m.id} style={{ padding: space.md }}>
              <Image
                accessibilityLabel={mediaKindLabel(m.kind)}
                source={{ uri: pictures[m.id] }}
                resizeMode="contain"
                style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.control }}
              />
            </View>
          ) : (
            <Row key={m.id} title={mediaKindLabel(m.kind)} subtitle={sizeLabel(m.size)} trailing={<Button label="Open" variant="secondary" size="sm" onPress={() => open(m.id)} />} />
          ),
        )}
      </Group>
      {error !== null && <Notice tone="danger">{error}</Notice>}
    </>
  );
}

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
  const promoKey = item?.conversationKey ?? item?.senderKey ?? null;
  const itemId = item?.id ?? null;
  const [promo, setPromo] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setPromo(promoKey === null || itemId === null ? null : InflowCore.smsPromotion(itemId));
    } catch {
      setPromo(null);
    }
  }, [promoKey, itemId]);
  const togglePromo = () => {
    if (promoKey === null || promo === null) return;
    try {
      InflowCore.setPromotion(promoKey, !promo);
      setPromo(!promo);
      setError(null);
    } catch {
      setError(SAVE_ERROR);
    }
  };
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
          {item.mediaCount > 0 && <MediaGroup itemId={item.id} />}
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
          {promo !== null && <Button label={promo ? 'Keep in my list' : 'Move to Promotions'} variant="secondary" onPress={togglePromo} block />}
          {senderKey !== null && <Button label={kept ? 'Send this sender to AI again' : "Don't send this sender to AI"} variant="secondary" onPress={toggleKept} block />}
          {who !== null && <Button label="Show everything from this sender" variant="secondary" onPress={() => onShowSender(who)} block />}
        </>
      )}
    </Sheet>
  );
}
