import type { Item } from '@apps-hub/library-core';
import { Button, Empty, Group, Header, Notice, Row, Screen, space, Text } from '@apps-hub/ui';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';

import { IconButton } from '../src/library/icon-button';
import { openItem } from '../src/library/open-item';
import { errorMessage } from '../src/library/use-library';
import { discardInbox, inboxDeps, inboxFile, readInbox } from '../src/nexus/share-inbox';
import { classifyShared, intakeShared, isInboxId, payloadFor, sizeLabel, type IntakeEntry, type LoadedShare } from '../src/nexus/share-intake';

const PREVIEW = 600;
const preview = (text: string) => (text.length > PREVIEW ? `${text.slice(0, PREVIEW).trimEnd()}…` : text);
const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

function EntryRow({ entry, inbox }: { entry: IntakeEntry; inbox: string }) {
  if (!entry.ok) return <Row title={entry.name} subtitle={`${entry.label}. ${entry.reason}`} />;
  if (entry.kind === 'note' || entry.kind === 'link') {
    return <Row title={<Text selectable>{preview(entry.kind === 'link' ? entry.url : entry.text)}</Text>} subtitle={entry.kind === 'link' ? 'Link, saved as a note' : 'Note'} />;
  }
  return (
    <Row
      title={entry.name}
      subtitle={`${entry.label} · ${sizeLabel(entry.size)}`}
      leading={
        entry.kind === 'image' ? (
          <Image source={{ uri: inboxFile(inbox, entry.file).uri }} style={{ width: 40, height: 52 }} contentFit="cover" accessibilityLabel={entry.name} />
        ) : undefined
      }
    />
  );
}

// Nothing is added before Add. Cancel, Back or leaving the screen any other way deletes the copies.
export default function ShareScreen() {
  const { inbox } = useLocalSearchParams<{ inbox?: string }>();
  const id = isInboxId(inbox) ? inbox : null;
  // A second share can reuse this screen with a new inbox id, so the payload is kept with the id it was read from.
  const [loaded, setLoaded] = useState<LoadedShare | undefined>(undefined);
  const payload = id ? payloadFor(loaded, id) : null;
  const [busy, setBusy] = useState(false);
  const taken = useRef(false);

  useEffect(() => {
    if (!id) return;
    let live = true;
    taken.current = false;
    setLoaded(undefined);
    readInbox(id)
      .then((p) => live && setLoaded({ id, payload: p }))
      .catch(() => live && setLoaded({ id, payload: null }));
    return () => {
      live = false;
      if (!taken.current) {
        try {
          discardInbox(id);
        } catch (err) {
          console.warn('Could not delete the shared copies', err);
        }
      }
    };
  }, [id]);

  const entries = payload ? classifyShared(payload) : [];
  const accepted = entries.filter((e) => e.ok).length;

  const add = async () => {
    if (!id || !payload || taken.current) return;
    taken.current = true;
    setBusy(true);
    try {
      const result = await intakeShared<Item>(payload, inboxDeps(id));
      if (result.failed.length) {
        Alert.alert(
          result.added.length ? 'Some of it was not added' : 'Nothing was added',
          result.failed.map((f) => `${f.name}: ${f.reason}`).join('\n'),
        );
      }
      router.replace('/');
      if (result.added.length === 1) await openItem(result.added[0]);
    } catch (err) {
      Alert.alert('Could not add it', errorMessage(err));
      leave();
    }
  };

  return (
    <Screen scroll>
      <Header title="Add to Nexus?" trailing={<IconButton icon="close" label="Cancel" onPress={leave} />} />
      {payload === undefined ? <Text tone="muted">Getting it ready…</Text> : null}
      {payload !== undefined && entries.length === 0 ? (
        <Empty title="Nothing to add" body="Nexus didn't get anything it can use from that share. Share it again from the other app." action={<Button label="Close" onPress={leave} />} />
      ) : null}
      {entries.length ? (
        <>
          <Text tone="muted">Nexus keeps it on this phone. If AI is on, it is read like anything else you add.</Text>
          <Group title={accepted === entries.length ? undefined : `${accepted} of ${entries.length} can be added`}>
            {entries.map((e, i) => (
              <EntryRow key={i} entry={e} inbox={id!} />
            ))}
          </Group>
          {accepted === 0 ? <Notice tone="warn" title="Nexus can't add any of this" /> : null}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="secondary" block disabled={busy} onPress={leave} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label={accepted > 1 ? `Add ${accepted}` : 'Add'} block busy={busy} disabled={accepted === 0} onPress={() => void add()} />
            </View>
          </View>
        </>
      ) : null}
    </Screen>
  );
}
