import DesignMedia, { type RemovedPhoto } from 'design-media';
import { Button, Empty, Group, Header, Notice, Progress, Row, Screen } from '@apps-hub/ui';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { plainError } from '../../src/media/errors';
import { removedText, restoredText } from '../../src/photos/cleanup';

export default function RecentlyRemoved() {
  const [photos, setPhotos] = useState<RemovedPhoto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // uri, or 'all'
  const [result, setResult] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const request = useRef(0);
  const open = useRef(false);

  const load = useCallback(() => {
    const n = ++request.current;
    setFailed(false);
    DesignMedia.recentlyRemoved().then(
      r => { if (n === request.current) setPhotos(r); },
      () => { if (n === request.current) setFailed(true); },
    );
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    return () => { request.current++; };
  }, [load]));

  async function restore(uris: string[], key: string) {
    if (open.current) return; // one Android dialog at a time
    open.current = true;
    setBusy(key);
    setResult(null);
    try {
      const { restored } = await DesignMedia.restorePhotos(uris);
      // 0: the owner said no in Android's dialog, so nothing to say
      if (restored > 0) {
        setResult({ tone: 'ok', text: restoredText(restored) });
        load();
      }
    } catch (e) {
      setResult({ tone: 'danger', text: plainError(e, "The photos weren't restored. Try again.") });
    } finally {
      open.current = false;
      setBusy(null);
    }
  }

  return (
    <Screen scroll>
      <Button label="Back" variant="ghost" onPress={() => router.back()} accessibilityHint="Goes back to Clean up" />
      <Header title="Recently removed" />
      <Notice>Your Gallery app may not show photos removed here. To get them back, restore them from this list.</Notice>
      {result ? <Notice tone={result.tone}>{result.text}</Notice> : null}
      {failed ? (
        <Notice
          tone="danger"
          title="Couldn't load Recently removed"
          action={<Button label="Try again" variant="secondary" onPress={load} accessibilityHint="Loads the list again" />}
        />
      ) : !photos ? (
        <Progress value={null} />
      ) : photos.length ? (
        <Group
          trailing={photos.length > 1 ? (
            <Button
              label="Restore all"
              variant="secondary"
              size="sm"
              busy={busy === 'all'}
              disabled={busy !== null}
              onPress={() => { void restore(photos.map(p => p.uri), 'all'); }}
              accessibilityHint="Puts every photo in this list back in your gallery"
            />
          ) : undefined}
        >
          {photos.map(p => (
            <Row
              key={p.uri}
              title={p.name}
              subtitle={removedText(p, Date.now())}
              trailing={
                <Button
                  label="Restore"
                  variant="secondary"
                  size="sm"
                  busy={busy === p.uri}
                  disabled={busy !== null}
                  onPress={() => { void restore([p.uri], p.uri); }}
                  accessibilityHint={`Puts ${p.name} back in your gallery`}
                />
              }
            />
          ))}
        </Group>
      ) : (
        <Empty title="Nothing removed" body="Photos you remove in Clean up stay here for 30 days." />
      )}
    </Screen>
  );
}
