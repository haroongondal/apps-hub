import DesignMedia from 'design-media';
import { Button, Empty, Field, Header, Notice, Progress, Screen, Sheet, Text, space } from '@apps-hub/ui';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Image, Linking, View, useWindowDimensions } from 'react-native';

import { plainError } from '../../src/media/errors';
import { isBusy, useQueue } from '../../src/media/queue';
import { askForPhotos, checkPhotos, type Access } from '../../src/photos/access';
import { PhotoGrid } from '../../src/photos/PhotoGrid';
import { getSearchTool } from '../../src/photos/search-tool';
import { realSearchToolDeps } from '../../src/photos/search-tool-deps';
import { photosView, scanLine, toolResultText, waitingText } from '../../src/photos/view';

type IndexState = Awaited<ReturnType<typeof DesignMedia.photoIndexState>>;

const say = (e: unknown) => Alert.alert('Something went wrong', plainError(e, 'Try again.'));
const intro = { title: 'Find photos by describing them', body: 'Type a few words, like dog on the beach, and see matching photos. Everything stays on your phone.' };

export default function PhotosTab() {
  const [access, setAccess] = useState<Access | null>(null);
  const [index, setIndex] = useState<IndexState | null>(null);
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  const [gettingTool, setGettingTool] = useState(false);
  const [fraction, setFraction] = useState(0);
  const [toolError, setToolError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<string[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [similar, setSimilar] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const preview = useWindowDimensions().width - 2 * space.lg;

  const job = useQueue().find(j => j.tool === 'photo-index' && isBusy(j));
  const running = job?.state === 'running';
  const progress = running ? job.progress : null;

  const refresh = useCallback(async () => {
    const a = await checkPhotos();
    const s = await DesignMedia.photoIndexState();
    setAccess(prev => (a === 'none' && prev === 'blocked' ? 'blocked' : a));
    setIndex(s);
    if (a === 'none' || !s.modelsReady || !(await DesignMedia.photoGalleryChanged())) return;
    if (focusedRef.current && AppState.currentState === 'active') await DesignMedia.startPhotoIndex();
  }, []);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      setFocused(true);
      refresh().catch(say);
      return () => {
        focusedRef.current = false;
        setFocused(false);
        DesignMedia.releasePhotoSearch().catch(() => undefined);
      };
    }, [refresh]),
  );

  useEffect(() => {
    if (!focused) return;
    const read = () => { DesignMedia.photoIndexState().then(setIndex, () => undefined); };
    read();
    if (!running) return;
    const poll = setInterval(read, 2000);
    return () => clearInterval(poll);
  }, [focused, running]);

  function search(q: string) {
    clearTimeout(timer.current);
    const n = ++request.current;
    setSearchError(null);
    if (!q.trim()) return setResults(null);
    DesignMedia.searchPhotos(q.trim()).then(
      r => { if (n === request.current) setResults(r); },
      e => { if (n === request.current) setSearchError(plainError(e, "The search didn't work. Try again.")); },
    );
  }

  function type(q: string) {
    setQuery(q);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => search(q), 400);
  }

  function moreLikeThis(uri: string) {
    setPicked(null);
    setSimilar(true);
    setSearchError(null);
    clearTimeout(timer.current);
    const n = ++request.current;
    DesignMedia.similarPhotos(uri).then(
      r => { if (n === request.current) setResults(r); },
      e => { if (n === request.current) setSearchError(plainError(e, "The search didn't work. Try again.")); },
    );
  }

  function clearSimilar() {
    setSimilar(false);
    search(query);
  }

  const ask = () => { askForPhotos().then(a => { setAccess(a); return refresh(); }).catch(say); };

  async function getTool() {
    setToolError(null);
    setFraction(0);
    setGettingTool(true);
    try {
      setToolError(toolResultText(await getSearchTool(realSearchToolDeps(), setFraction)));
    } catch (e) {
      setToolError(plainError(e, toolResultText('bad-download') ?? 'Try again.'));
    } finally {
      setGettingTool(false);
    }
    await refresh().catch(say);
  }

  if (!access || !index) return <Screen scroll><Header title="Photos" /></Screen>;

  const view = photosView({ access, modelsReady: index.modelsReady, gettingTool, indexed: index.indexed, scanning: !!job });
  const waiting = job ? waitingText(index.waiting) : null;
  const waitingNotice = waiting ? <Notice tone="warn">{waiting}</Notice> : null;

  if (view === 'ask' || view === 'blocked') {
    return (
      <Screen scroll>
        <Header title="Photos" />
        <Empty
          title={intro.title}
          body={intro.body}
          action={view === 'ask'
            ? <Button label="Allow access to photos" onPress={ask} accessibilityHint="Asks for access to your photos" />
            : <Button label="Open settings" onPress={() => { Linking.openSettings().catch(say); }} accessibilityHint="Opens this app's settings, where you can allow photos" />}
        />
      </Screen>
    );
  }

  if (view === 'get-tool' || view === 'getting-tool') {
    return (
      <Screen scroll>
        <Header title="Photos" />
        {view === 'get-tool' ? (
          <>
            <Notice
              title="Get the search tool once"
              action={<Button label="Get the search tool" onPress={() => { void getTool(); }} accessibilityHint="Downloads the search tool" />}
            >
              It's 216 MB and works offline after that. Use Wi-Fi if you can.
            </Notice>
            {toolError ? <Notice tone="danger">{toolError}</Notice> : null}
          </>
        ) : (
          <View style={{ gap: space.sm }}>
            <Text>Getting the search tool</Text>
            <Progress value={fraction} />
          </View>
        )}
      </Screen>
    );
  }

  if (view === 'preparing') {
    return (
      <Screen scroll>
        <Header title="Photos" />
        <View style={{ gap: space.sm }}>
          <Text>{scanLine(index.indexed, progress)}</Text>
          <Progress value={progress} />
        </View>
        {waitingNotice}
      </Screen>
    );
  }

  const header = (
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md, gap: space.xl }}>
      <Header
        title="Photos"
        trailing={<Button label="Scan now" variant="ghost" onPress={() => { DesignMedia.startPhotoIndex().catch(say); }} accessibilityHint="Looks for new photos to search" />}
      />
      {similar ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Text variant="bodyStrong" style={{ flex: 1 }}>More like this</Text>
          <Button label="Clear" variant="secondary" onPress={clearSimilar} accessibilityHint="Goes back to your search" />
        </View>
      ) : (
        <Field
          label="Search your photos"
          placeholder="Describe a photo"
          value={query}
          onChangeText={type}
          onSubmitEditing={() => search(query)}
          returnKeyType="search"
          hint={job ? scanLine(index.indexed, progress) : undefined}
          error={searchError}
        />
      )}
      {waitingNotice}
      {access === 'some' ? (
        <Notice
          title="Only the photos you picked can be found"
          action={<Button label="Change" variant="secondary" onPress={ask} accessibilityHint="Choose which photos can be searched" />}
        />
      ) : null}
    </View>
  );

  return (
    <Screen>
      <PhotoGrid
        uris={results ?? []}
        header={header}
        empty={results ? <Empty title="No close matches" body="Try other words." /> : null}
        onPick={setPicked}
      />
      <Sheet visible={picked !== null} onClose={() => setPicked(null)} title="Photo">
        {picked ? <Image source={{ uri: picked }} resizeMethod="resize" resizeMode="contain" style={{ width: preview, height: preview }} accessibilityLabel="The photo you picked" /> : null}
        <Button
          label="Open"
          onPress={() => { if (picked) DesignMedia.open(picked).catch(() => Alert.alert("This photo can't be opened", 'It may have been deleted.')); }}
          accessibilityHint="Opens this photo in your photo viewer"
        />
        <Button label="More like this" variant="secondary" onPress={() => { if (picked) moreLikeThis(picked); }} accessibilityHint="Shows photos that look like this one" />
      </Sheet>
    </Screen>
  );
}
