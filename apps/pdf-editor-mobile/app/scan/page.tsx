import type { ScanPage } from '@apps-hub/scan-core';
import { Button, Header, Notice, Screen, space } from '@apps-hub/ui';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image as RNImage, View } from 'react-native';

import { IconButton } from '../../src/library/icon-button';
import { itemFile } from '../../src/library/paths';
import { errorMessage } from '../../src/library/use-library';
import { CropEditor } from '../../src/scan/crop-editor';
import { saveImages, savedMessage, shareImages } from '../../src/scan/export';
import { FilterPicker } from '../../src/scan/filter-picker';
import { getScanService } from '../../src/scan/service';
import type { PageFilter, Rotation } from '../../src/scan/session-data';

interface Draft {
  quad: ScanPage['quad'];
  rotation: Rotation;
  filter: PageFilter;
}

export default function PageScreen() {
  const { id, pageId } = useLocalSearchParams<{ id: string; pageId: string }>();
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [origSize, setOrigSize] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const index = pages.findIndex((p) => p.pageId === pageId);
  const page: ScanPage | undefined = pages[index];
  const sheet = page?.kind === 'sheet';
  const origUri = itemFile(id, `pages/${pageId}.orig.jpg`).uri;

  const load = useCallback(async () => {
    try {
      setPages(await (await getScanService()).pages(id));
    } catch (e) {
      setError(`The page couldn't be opened. ${errorMessage(e)}`);
    }
  }, [id]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (!draft || sheet || origSize) return;
    RNImage.getSize(origUri, (w, h) => setOrigSize({ w, h }), () => setError("The original photo couldn't be read. Cancel the edit and try again."));
  }, [draft, sheet, origSize, origUri]);

  const run = (work: () => Promise<string | void>, failure: string) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    work()
      .then((done) => done && setMessage(done))
      .catch((e: unknown) => setError(`${failure} ${errorMessage(e)}`))
      .finally(() => setBusy(false));
  };

  const applyEdit = () =>
    draft &&
    run(async () => {
      await (await getScanService()).editPage(id, pageId, sheet ? { rotation: draft.rotation } : draft);
      setDraft(null);
      await load();
    }, "The changes weren't saved. The page is unchanged, so try again.");

  const move = (to: number) =>
    run(async () => {
      const ids = pages.map((p) => p.pageId);
      [ids[index], ids[to]] = [ids[to], ids[index]];
      await (await getScanService()).reorder(id, ids);
      await load();
    }, "The page wasn't moved.");

  const confirmDelete = () =>
    Alert.alert(`Delete page ${index + 1}?`, "This removes it from the scan and can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          run(async () => {
            try {
              await (await getScanService()).deletePage(id, pageId);
            } catch (e) {
              if ((e as { code?: string }).code === 'last_page') throw new Error('A scan needs at least one page. Delete the whole scan from the Library instead.');
              throw e;
            }
            router.back();
          }, "The page wasn't deleted."),
      },
    ]);

  if (!page) {
    return (
      <Screen scroll>
        <Header title="Page" trailing={<IconButton icon="arrow-back" label="Back" onPress={() => router.back()} />} />
        {error ? <Notice tone="danger" title="Something went wrong">{error}</Notice> : <ActivityIndicator accessibilityLabel="Loading the page" />}
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title={`Page ${index + 1}`} subtitle={`of ${pages.length}`} trailing={<IconButton icon="arrow-back" label="Back" onPress={() => router.back()} />} />
      {message ? <Notice tone="ok" action={<Button label="Dismiss" size="sm" variant="secondary" onPress={() => setMessage(null)} />}>{message}</Notice> : null}
      {error ? <Notice tone="danger" title="Something went wrong" action={<Button label="Dismiss" size="sm" variant="secondary" onPress={() => setError(null)} />}>{error}</Notice> : null}

      {draft && !sheet ? (
        origSize ? (
          <CropEditor uri={origUri} imageWidth={origSize.w} imageHeight={origSize.h} quad={draft.quad} onChange={(quad) => setDraft({ ...draft, quad })} />
        ) : (
          <ActivityIndicator accessibilityLabel="Loading the photo" />
        )
      ) : (
        <Image
          key={`${pageId}-${page.rotation}-${page.filter}-${page.width}x${page.height}-${page.quad.join(',')}`}
          source={{ uri: itemFile(id, `pages/${pageId}.jpg`).uri }}
          style={{ width: '100%', aspectRatio: page.width / Math.max(1, page.height) }}
          contentFit="contain"
          cachePolicy="none"
          accessibilityLabel={`Page ${index + 1}`}
        />
      )}

      {draft ? (
        <>
          {sheet ? null : <FilterPicker value={draft.filter} onChange={(filter) => setDraft({ ...draft, filter })} />}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Button label="Rotate" size="sm" variant="secondary" onPress={() => setDraft({ ...draft, rotation: ((draft.rotation + 90) % 360) as Rotation })} />
          </View>
          <Button label="Save changes" block busy={busy} onPress={applyEdit} />
          <Button label="Cancel" block variant="secondary" disabled={busy} onPress={() => setDraft(null)} />
        </>
      ) : (
        <View style={{ gap: space.sm }}>
          <Button label="Edit page" block onPress={() => setDraft({ quad: page.quad, rotation: page.rotation, filter: page.filter })} disabled={busy} />
          <Button label="Save image" block variant="secondary" disabled={busy} onPress={() => run(async () => savedMessage(await saveImages(id, [pageId])), "The image wasn't saved. Check that the phone has free space, then try again.")} />
          <Button label="Share image" block variant="secondary" disabled={busy} onPress={() => run(() => shareImages(id, [pageId]), "The image couldn't be shared.")} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Button label="Move left" size="sm" variant="secondary" disabled={busy || index === 0} onPress={() => move(index - 1)} />
            <Button label="Move right" size="sm" variant="secondary" disabled={busy || index === pages.length - 1} onPress={() => move(index + 1)} />
            <Button label="Delete page" size="sm" variant="danger" disabled={busy} onPress={confirmDelete} />
          </View>
        </View>
      )}
    </Screen>
  );
}
