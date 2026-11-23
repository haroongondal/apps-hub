import type { Item } from '@apps-hub/library-core';
import type { ScanPage } from '@apps-hub/scan-core';
import { Button, Header, Notice, Screen, radius, space, useTheme } from '@apps-hub/ui';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { IconButton } from '../../src/library/icon-button';
import { openLibrary } from '../../src/library/open-library';
import { itemFile } from '../../src/library/paths';
import { errorMessage } from '../../src/library/use-library';
import { openInEditor, saveImages, savedMessage, shareImages, sharePdf } from '../../src/scan/export';
import { getScanService } from '../../src/scan/service';
import { discardSession, loadSession, saveSession } from '../../src/scan/session';
import { newSession } from '../../src/scan/session-data';

const COLUMNS = 3;

export default function ScanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const [item, setItem] = useState<Item | null>(null);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          const found = await (await openLibrary()).getItem(id);
          const list = await (await getScanService()).pages(id);
          if (!alive) return;
          if (!found) throw new Error('This scan is no longer in the library. Go back and pick another.');
          setItem(found);
          setPages(list);
        } catch (e) {
          if (alive) setError(`The scan couldn't be opened. ${errorMessage(e)}`);
        }
      })();
      return () => {
        alive = false;
      };
    }, [id]),
  );

  const run = (name: string, work: () => Promise<string | void>, failure: string) => {
    if (busy) return;
    setBusy(name);
    setMessage(null);
    setError(null);
    work()
      .then((done) => done && setMessage(done))
      .catch((e: unknown) => setError(`${failure} ${errorMessage(e)}`))
      .finally(() => setBusy(null));
  };

  const startAppend = () => {
    const begin = () => {
      discardSession();
      saveSession({ ...newSession(item?.folderId ?? null, Date.now()), appendTo: id });
      router.push('/scan/capture');
    };
    const unsaved = loadSession()?.pages.length ?? 0;
    if (unsaved === 0) return begin();
    Alert.alert('Discard the unsaved scan?', `${unsaved} scanned ${unsaved === 1 ? 'page is' : 'pages are'} waiting to be saved. Adding pages here discards them.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard and continue', style: 'destructive', onPress: begin },
    ]);
  };

  const count = `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`;

  return (
    <Screen scroll>
      <Header title={item?.title ?? 'Scan'} subtitle={count} trailing={<IconButton icon="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />} />
      {message ? <Notice tone="ok" action={<Button label="Dismiss" size="sm" variant="secondary" onPress={() => setMessage(null)} />}>{message}</Notice> : null}
      {error ? <Notice tone="danger" title="Something went wrong" action={<Button label="Dismiss" size="sm" variant="secondary" onPress={() => setError(null)} />}>{error}</Notice> : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {pages.map((p, i) => (
          <Pressable
            key={p.pageId}
            onPress={() => router.push({ pathname: '/scan/page', params: { id, pageId: p.pageId } })}
            accessibilityRole="button"
            accessibilityLabel={`Page ${i + 1} of ${pages.length}`}
            style={{ width: `${100 / COLUMNS - 2}%`, aspectRatio: 0.72, borderRadius: radius.control, overflow: 'hidden', borderWidth: 1, borderColor: c.line, backgroundColor: c.raised }}
          >
            <Image key={`${p.pageId}-${p.rotation}-${p.filter}-${p.width}x${p.height}-${p.quad.join(',')}`} source={{ uri: itemFile(id, `pages/${p.pageId}.jpg`).uri }} style={{ flex: 1 }} contentFit="cover" cachePolicy="none" />
          </Pressable>
        ))}
      </View>

      <View style={{ gap: space.sm }}>
        <Button label="Share PDF" block busy={busy === 'pdf'} disabled={!!busy || pages.length === 0} onPress={() => run('pdf', () => sharePdf(id), "The PDF couldn't be shared.")} />
        <Button label="Open in editor" block variant="secondary" busy={busy === 'editor'} disabled={!!busy || pages.length === 0} onPress={() => run('editor', () => openInEditor(id), "The PDF couldn't be opened.")} />
        <Button
          label="Save images"
          block
          variant="secondary"
          busy={busy === 'save'}
          disabled={!!busy || pages.length === 0}
          onPress={() => run('save', async () => savedMessage(await saveImages(id)), "The images weren't saved. Check that the phone has free space, then try again.")}
        />
        <Button label="Share images" block variant="secondary" busy={busy === 'images'} disabled={!!busy || pages.length === 0} onPress={() => run('images', () => shareImages(id), "The images couldn't be shared.")} />
        <Button label="Read as receipt" block variant="secondary" disabled={!!busy || pages.length === 0} onPress={() => router.push({ pathname: '/scan/receipt', params: { id } })} />
        <Button label="Add pages" block variant="secondary" disabled={!!busy || !item} onPress={startAppend} />
      </View>
    </Screen>
  );
}
