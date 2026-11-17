import DesignMedia, { type CleanupGroup } from 'design-media';
import { Button, Empty, Group, Notice, Progress, Row, Text, space } from '@apps-hub/ui';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, View } from 'react-native';

import { plainError } from '../media/errors';
import type { Access } from './access';
import { kindRows, lastScanText } from './cleanup';

const say = (e: unknown) => Alert.alert("Couldn't show them again", plainError(e, 'Try again.'));

export function CleanupOverview({ lastScan, scanning, access, onChangeAccess }: {
  lastScan: number; scanning: boolean; access: Access; onChangeAccess: () => void;
}) {
  const [groups, setGroups] = useState<CleanupGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);

  const load = useCallback(() => {
    const n = ++request.current;
    setFailed(false);
    DesignMedia.cleanupGroups().then(
      r => { if (n === request.current) setGroups(r.groups); },
      () => { if (n === request.current) setFailed(true); },
    );
  }, []);

  // lastScan is unused in the body on purpose: a new callback makes useFocusEffect run again, so a finished scan reloads
  useFocusEffect(useCallback(() => {
    load();
    return () => { request.current++; };
  }, [load, lastScan]));

  function showHidden() {
    Alert.alert('Show hidden photos again?', 'Photos you marked as not a mistake will be suggested again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Show them', onPress: () => { DesignMedia.clearCleanupDismissals().then(load, say); } },
    ]);
  }

  const rows = groups ? kindRows(groups) : [];

  return (
    <>
      <View style={{ gap: space.xs }}>
        <Text tone="muted">{lastScanText(lastScan, Date.now())}</Text>
        {scanning ? <Text tone="muted">Still checking your photos. More may show up when it's done.</Text> : null}
      </View>
      {access === 'some' ? (
        <Notice
          title="Only the photos you picked are checked"
          action={<Button label="Change" variant="secondary" onPress={onChangeAccess} accessibilityHint="Choose which photos are checked" />}
        />
      ) : null}
      {failed ? (
        <Notice
          tone="danger"
          title="Couldn't load Clean up"
          action={<Button label="Try again" variant="secondary" onPress={load} accessibilityHint="Loads Clean up again" />}
        />
      ) : !groups ? (
        <Progress value={null} />
      ) : rows.length ? (
        <Group>
          {rows.map(r => (
            <Row
              key={r.kind}
              title={r.title}
              subtitle={r.subtitle}
              accessibilityLabel={r.label}
              accessibilityHint="Shows these photos so you can pick which to remove"
              onPress={() => router.push(`/cleanup/${r.kind}`)}
            />
          ))}
        </Group>
      ) : (
        <Empty title="Nothing to clean up" body="No blurry photos, copies or look-alikes right now." />
      )}
      <Group>
        <Row title="Recently removed" onPress={() => router.push('/cleanup/removed')} accessibilityHint="Shows photos you removed, so you can restore them" />
      </Group>
      <Button label="Show hidden photos again" variant="ghost" onPress={showHidden} accessibilityHint="Asks first, then suggests them again" />
    </>
  );
}
