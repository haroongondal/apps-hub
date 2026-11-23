import DesignMedia from 'design-media';
import { formatMb } from '@apps-hub/media-core';
import { Button, Group, Header, Notice, Pill, Row, Screen, radius, useTheme } from '@apps-hub/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';

import { readInbox, removeFromInbox } from '../src/media/share';
import type { InboxItem } from '../src/media/share-intake.ts';
import { defaultTicked, handOff, mixedKinds, toolsFor } from '../src/media/share-tools';

const SIZE = 56;

function Thumb({ item, slot }: { item: InboxItem; slot: number }) {
  const { c } = useTheme();
  const [video, setVideo] = useState<string>();
  useEffect(() => {
    if (item.kind !== 'video') return;
    const folder = `share-${slot}`;
    DesignMedia.thumbnails(item.uri, [0.5], SIZE * 2, folder).then(files => setVideo(files[0]), () => undefined);
    return () => { void DesignMedia.clearThumbs(folder).catch(() => undefined); };
  }, [item.kind, item.uri, slot]);
  const uri = item.kind === 'image' ? item.uri : video;
  const box = { width: SIZE, height: SIZE, borderRadius: radius.control, backgroundColor: c.raised };
  return uri ? <Image source={{ uri }} resizeMode="cover" accessibilityIgnoresInvertColors style={box} /> : <View style={box} />;
}

export default function AddToDesignEditor() {
  const { notes, at } = useLocalSearchParams<{ notes?: string; at?: string }>();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [ticked, setTicked] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void readInbox().then(list => { setItems(list); setTicked(defaultTicked(list)); setLoaded(true); }, () => setLoaded(true));
  }, [at]);

  const chosen = items.filter(i => ticked.includes(i.uri));
  const tools = toolsFor(chosen);
  const toggle = (uri: string) => setTicked(ticked.includes(uri) ? ticked.filter(u => u !== uri) : [...ticked, uri]);

  async function removeChosen() {
    await removeFromInbox(chosen.map(i => i.uri));
    setItems(items.filter(i => !ticked.includes(i.uri)));
    setTicked([]);
  }

  function open(tool: (typeof tools)[number]) {
    handOff(chosen);
    router.push({ pathname: '/media/[tool]', params: { tool: tool.key } });
  }

  return (
    <Screen scroll>
      <Header title="Add to Design Editor" subtitle="These copies stay on your phone. Nothing is changed or sent until you choose." />
      {notes ? <Notice tone="warn" title="Some items were left out">{notes}</Notice> : null}

      {loaded && !items.length ? (
        <Notice tone="accent" title="Nothing here yet">Share a picture or video to Design Editor from your gallery and it shows up here.</Notice>
      ) : null}

      {items.length ? (
        <Group title="Shared with you" footer="Tap a picture or video to choose it or leave it out.">
          {items.map((item, slot) => (
            <Row
              key={item.uri}
              leading={<Thumb item={item} slot={slot} />}
              title={item.name}
              subtitle={`${item.kind === 'image' ? 'Picture' : 'Video'} · ${formatMb(item.bytes)}`}
              trailing={ticked.includes(item.uri) ? <Pill label="Chosen" tone="accent" /> : undefined}
              onPress={() => toggle(item.uri)}
              accessibilityHint={ticked.includes(item.uri) ? 'Leaves it out' : 'Chooses it'}
            />
          ))}
        </Group>
      ) : null}

      {items.length && mixedKinds(chosen) ? <Notice tone="warn">Choose pictures or videos, not both at once.</Notice> : null}
      {items.length && !chosen.length ? <Notice tone="accent">Choose at least one to see what you can do with it.</Notice> : null}

      {tools.length ? (
        <Group title="What do you want to do?" footer={chosen.length === 1 ? undefined : 'Tools that work on one video at a time show up when you choose just one.'}>
          {tools.map(t => <Row key={t.key} title={t.title} subtitle={t.about} onPress={() => open(t)} accessibilityHint={`Opens ${t.title} with your choice`} />)}
        </Group>
      ) : null}

      {items.length ? (
        <Group>
          <Button label="Add to my media" variant="secondary" block onPress={() => router.dismissTo('/media')} accessibilityHint="Keeps them in the Media tab for later" />
          <Button label="Remove chosen" variant="ghost" block disabled={!chosen.length} onPress={removeChosen} accessibilityHint="Deletes the copies Design Editor made" />
        </Group>
      ) : <Button label="Back to Design Editor" variant="secondary" block onPress={() => router.dismissTo('/media')} />}
    </Screen>
  );
}
