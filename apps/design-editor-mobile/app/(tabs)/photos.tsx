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
import { noMatches, scanText } from '../../src/photos/screen-text';
import { photosView, scanDecision, toolResultText, waitingText } from '../../src/photos/view';

type IndexState = Awaited<ReturnType<typeof DesignMedia.photoIndexState>>;

const release = () => { DesignMedia.releasePhotoSearch().catch(() => undefined); };

const say = (e: unknown) => Alert.alert('Something went wrong', plainError(e, 'Try again.'));
const intro = { title: 'Find photos by describing them', body: 'Type a few words, like dog on the beach, and see matching photos. Everything stays on your phone.' };

export default function PhotosTab() {
  const [access, setAccess] = useState<Access | null>(null);
  const accessRef = useRef<Access | null>(null);
  const [index, setIndex] = useState<IndexState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const pendingScan = useRef(false);
  const inFlight = useRef<Promise<unknown>>(Promise.resolve());
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

  const keepAccess = (a: Access) => { accessRef.current = a; setAccess(a); };

  const refresh = useCallback(async (scan = false) => {
    let a: Access;
    let s: IndexState;
    try {
      a = await checkPhotos();
      s = await DesignMedia.photoIndexState();
    } catch {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    const before = accessRef.current;
    keepAccess(a === 'none' && before === 'blocked' ? 'blocked' : a);
    setIndex(s);
    if (a === 'none' || !s.modelsReady || !focusedRef.current) return;
    // asked only when nothing else already decides; if it can't be read, scan rather than lose the scan
    const decided = scan || (before !== null && before !== a);
    const galleryChanged = decided || (await DesignMedia.photoGalleryChanged().catch(() => true));
    const todo = scanDecision({ before, access: a, force: scan, modelsReady: s.modelsReady, galleryChanged, active: AppState.currentState === 'active' });
    if (todo === 'scan') await DesignMedia.startPhotoIndex();
    else if (todo === 'pending') pendingScan.current = true;
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active' || !focusedRef.current) return;
      const scan = pendingScan.current;
      pendingScan.current = false;
      refresh(scan).catch(say);
    });
    return () => sub.remove();
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      setFocused(true);
      refresh().catch(say);
      return () => {
        focusedRef.current = false;
        setFocused(false);
        clearTimeout(timer.current);
        request.current++;
        // a search still running would load the text model again, so release once it settles
        void inFlight.current.then(() => { if (!focusedRef.current) release(); });
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
    show(n, DesignMedia.searchPhotos(q.trim()));
  }

  function show(n: number, p: Promise<string[]>) {
    inFlight.current = Promise.allSettled([inFlight.current, p]).then(() => undefined);
    p.then(
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
    setResults(null);
    clearTimeout(timer.current);
    const n = ++request.current;
    show(n, DesignMedia.similarPhotos(uri));
  }

  function clearSimilar() {
    setSimilar(false);
    search(query);
  }

  const ask = () => { askForPhotos().then(a => { keepAccess(a); return refresh(a === 'all' || a === 'some'); }).catch(say); };

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

  if (!access || !index) {
    return (
      <Screen scroll>
        <Header title="Photos" />
        {loadError ? (
          <Notice
            tone="danger"
            title="Couldn't check your photos"
            action={<Button label="Try again" variant="secondary" onPress={() => { refresh().catch(say); }} accessibilityHint="Checks your photos again" />}
          />
        ) : null}
      </Screen>
    );
  }

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
          <Text>{scanText(index.indexed, job?.state, progress)}</Text>
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
        trailing={job ? undefined : <Button label="Scan now" variant="ghost" onPress={() => { DesignMedia.startPhotoIndex().catch(say); }} accessibilityHint="Looks for new photos to search" />}
      />
      {similar ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Text variant="bodyStrong" style={{ flex: 1 }}>More like this</Text>
          <Button label="Clear" variant="secondary" onPress={clearSimilar} accessibilityHint="Goes back to your search" />
        </View>
      ) : null}
      {similar && searchError ? <Notice tone="danger">{searchError}</Notice> : null}
      {similar ? null : (
        <Field
          label="Search your photos"
          placeholder="Describe a photo"
          value={query}
          onChangeText={type}
          onSubmitEditing={() => search(query)}
          returnKeyType="search"
          hint={job ? scanText(index.indexed, job.state, progress) : undefined}
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
        empty={results ? <Empty {...noMatches(similar)} /> : null}
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
