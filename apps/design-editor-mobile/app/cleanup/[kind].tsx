import Ionicons from '@expo/vector-icons/Ionicons';
import DesignMedia, { type CleanupGroup, type CleanupKind, type CleanupPhoto, type CleanupResult } from 'design-media';
import { Button, Empty, Header, Notice, Progress, Screen, Sheet, Text, alpha, radius, space, useTheme, type Tone } from '@apps-hub/ui';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Image, Pressable, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { plainError } from '../../src/media/errors';
import {
  deleteLabel, doneText, hiddenText, initialTicks, kindName, mergeTicks, photosText, restoredText, selection, tickAll, wholeSetTicked,
  type Ticks,
} from '../../src/photos/cleanup';
import { StrictnessSlider } from '../../src/photos/StrictnessSlider';

const KINDS: CleanupKind[] = ['blurry', 'copies', 'lookalikes', 'screenshots', 'dark'];

export default function CleanupKindRoute() {
  const { kind } = useLocalSearchParams<{ kind: string }>();
  const known = KINDS.find(k => k === kind);
  if (known) return <Review key={known} kind={known} />;
  return (
    <Screen scroll>
      <Button label="Back" variant="ghost" onPress={() => router.back()} accessibilityHint="Goes back to Clean up" />
      <Empty title="Nothing to clean up" />
    </Screen>
  );
}

type Message = { tone: Tone; text: string; undo?: () => void };
type Item = { key: string; head: string[] } | { key: string; photos: CleanupPhoto[]; start: number; total: number };

function Review({ kind }: { kind: CleanupKind }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const width = useWindowDimensions().width;
  const tile = (width - 2 * space.xs) / 3;
  const sets = kind === 'copies' || kind === 'lookalikes';

  const [groups, setGroups] = useState<CleanupGroup[] | null>(null);
  const [blur, setBlur] = useState<CleanupResult['blur'] | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null); // null: the engine's default
  const [ticks, setTicks] = useState<Ticks>({});
  const [loadError, setLoadError] = useState(false);
  const [message, setMessage] = useState<Message | null>(null); // errors, Hidden + Undo, Restored
  const [undo, setUndo] = useState<Message | null>(null); // the latest Done + Undo; other messages don't replace it
  const [busy, setBusy] = useState(false);
  const open = useRef(false); // a trash or restore request is open; the ref stops a second tap before busy renders
  const [picked, setPicked] = useState<string | null>(null);
  const request = useRef(0);
  const loaded = useRef(false);

  const load = useCallback(() => {
    const n = ++request.current;
    DesignMedia.cleanupGroups(kind === 'blurry' && threshold !== null ? { blurThreshold: threshold } : undefined).then(
      r => {
        if (n !== request.current) return;
        const gs = r.groups.filter(g => g.kind === kind);
        const first = !loaded.current;
        loaded.current = true;
        setBlur(r.blur);
        setGroups(gs);
        setTicks(t => (first ? initialTicks(gs) : mergeTicks(t, gs)));
        setLoadError(false);
      },
      () => { if (n === request.current) setLoadError(true); },
    );
  }, [kind, threshold]);
  const loadRef = useRef(load); // Undo closures outlive the render that made them; reload with the current threshold
  loadRef.current = load;

  useFocusEffect(useCallback(() => {
    load();
    return () => { request.current++; };
  }, [load]));

  async function guarded(run: () => Promise<void>) {
    if (open.current) return;
    open.current = true;
    setBusy(true);
    try {
      await run();
    } finally {
      open.current = false;
      setBusy(false);
    }
  }

  // AC-1: the only call that moves photos out of the gallery, with exactly the ticked photos still shown.
  const remove = (uris: string[]) => guarded(async () => {
    try {
      const a = await DesignMedia.trashPhotos(uris);
      if (a.moved === 0) return; // the owner said no in Android's dialog: nothing changes, nothing is said
      setMessage(null); // a new delete replaces the older Restored or Hidden line
      setUndo({ tone: 'ok', text: doneText(a.moved, a.noted), undo: () => { void restore(a.uris); } });
      // take the trashed photos off screen and out of the ticks now, before the reload lands
      const gone = new Set(a.uris);
      setTicks(t => Object.fromEntries(Object.entries(t).filter(([u]) => !gone.has(u))));
      setGroups(gs => gs && gs
        .map(g => ({ ...g, photos: g.photos.filter(p => !gone.has(p.uri)) }))
        .filter(g => g.photos.length >= (sets ? 2 : 1)));
      loadRef.current();
    } catch (e) {
      setMessage({ tone: 'danger', text: plainError(e, "The photos weren't moved. Try again.") });
    }
  });

  const restore = (uris: string[]) => guarded(async () => {
    try {
      const a = await DesignMedia.restorePhotos(uris);
      if (a.restored === 0) return; // said no: the Done notice and its Undo stay
      setUndo(null);
      setMessage({ tone: 'ok', text: restoredText(a.restored) });
      loadRef.current();
    } catch (e) {
      setMessage({ tone: 'danger', text: plainError(e, "The photos weren't restored. Try again.") });
    }
  });

  async function dismiss(uris: string[]) {
    setPicked(null);
    try {
      await DesignMedia.dismissCleanup(kind, uris);
      setMessage({ tone: 'neutral', text: hiddenText(kind), undo: () => { void undismiss(uris); } });
      loadRef.current();
    } catch (e) {
      setMessage({ tone: 'danger', text: plainError(e, "Couldn't hide these photos. Try again.") });
    }
  }

  async function undismiss(uris: string[]) {
    try {
      await DesignMedia.undismissCleanup(kind, uris);
      setMessage(null);
      loadRef.current();
    } catch (e) {
      setMessage({ tone: 'danger', text: plainError(e, "Couldn't show them again. Try again.") });
    }
  }

  // P3: one section per set for copies and look-alikes; every other kind is one section.
  const items = useMemo<Item[]>(() => {
    const sections = !groups ? [] : sets ? groups.map(g => ({ key: g.key, photos: g.photos })) : [{ key: kind, photos: groups.flatMap(g => g.photos) }];
    return sections.filter(s => s.photos.length).flatMap(s => {
      const rows: Item[] = sets ? [{ key: `${s.key}:head`, head: s.photos.map(p => p.uri) }] : [];
      for (let i = 0; i < s.photos.length; i += 3) rows.push({ key: `${s.key}:${i}`, photos: s.photos.slice(i, i + 3), start: i, total: s.photos.length });
      return rows;
    });
  }, [groups, sets, kind]);

  const chosen = groups ? selection(groups, ticks) : { uris: [], count: 0, bytes: 0 };
  const any = items.length > 0;

  const header = (
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md, gap: space.xl }}>
      <Button label="Back" variant="ghost" onPress={() => router.back()} accessibilityHint="Goes back to Clean up" />
      <Header title={kindName(kind)} />
      {loadError ? (
        <Notice
          tone="danger"
          title="Couldn't load Clean up"
          action={<Button label="Try again" variant="secondary" onPress={load} accessibilityHint="Loads these photos again" />}
        />
      ) : null}
      {kind === 'blurry' && blur ? <StrictnessSlider value={threshold ?? blur.default} blur={blur} onChange={setThreshold} /> : null}
      {any ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="Tick all" variant="secondary" size="sm" onPress={() => groups && setTicks(tickAll(groups, true))} accessibilityHint="Ticks every photo except the best ones" />
          <Button label="Untick all" variant="secondary" size="sm" onPress={() => groups && setTicks(tickAll(groups, false))} accessibilityHint="Unticks every photo" />
        </View>
      ) : null}
    </View>
  );

  function renderTile(p: CleanupPhoto, n: number, total: number) {
    const on = !!ticks[p.uri];
    return (
      <Pressable
        key={n}
        onPress={() => setTicks(t => ({ ...t, [p.uri]: !t[p.uri] }))}
        onLongPress={() => setPicked(p.uri)}
        accessibilityActions={[{ name: 'longpress', label: 'More options' }]}
        onAccessibilityAction={e => { if (e.nativeEvent.actionName === 'longpress') setPicked(p.uri); }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        accessibilityLabel={`Photo ${n + 1} of ${total}${p.best ? ', best' : ''}`}
        style={{ width: tile, height: tile, backgroundColor: c.raised }}
      >
        <Image source={{ uri: p.uri }} resizeMethod="resize" style={{ width: tile, height: tile }} />
        {on ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderWidth: 3, borderColor: c.accent }} /> : null}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute', top: space.sm, right: space.sm, width: 26, height: 26, borderRadius: radius.pill,
            alignItems: 'center', justifyContent: 'center', borderWidth: 2,
            borderColor: on ? c.accent : c.text, backgroundColor: on ? c.accent : alpha(c.bg, 0.5),
          }}
        >
          {on ? <Ionicons name="checkmark" size={18} color={c.onAccent} /> : null}
        </View>
        {p.best ? <View pointerEvents="none" style={{ position: 'absolute', left: space.sm, bottom: space.sm }}><View style={{ backgroundColor: c.accent, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 }}><Text variant="meta" style={{ color: c.onAccent }}>Best</Text></View></View> : null}
      </Pressable>
    );
  }

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={i => i.key}
        ListHeaderComponent={header}
        ListEmptyComponent={
          groups ? <Empty title="Nothing to clean up" body={kind === 'blurry' ? 'Move the slider to see more.' : undefined} />
            : loadError ? null : <View style={{ paddingHorizontal: space.lg }}><Progress value={null} /></View>
        }
        contentContainerStyle={{ gap: space.xs, paddingBottom: space.xl }}
        renderItem={({ item }) => 'head' in item ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.md }}>
            <Text variant="meta" tone="muted" style={{ flex: 1 }}>{photosText(item.head.length)}</Text>
            <Button label="Not a mistake" variant="ghost" size="sm" onPress={() => { void dismiss(item.head); }} accessibilityHint="Stops suggesting these photos here" />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: space.xs }}>
            {item.photos.map((p, i) => renderTile(p, item.start + i, item.total))}
          </View>
        )}
      />
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: insets.bottom + space.md, gap: space.md, borderTopWidth: 1, borderColor: c.line, backgroundColor: c.bg }}>
        {[undo, message].map((m, i) => m ? (
          <Notice
            key={i}
            tone={m.tone}
            action={m.undo ? <Button label="Undo" variant="secondary" size="sm" busy={busy} onPress={m.undo} /> : undefined}
          >
            {m.text}
          </Notice>
        ) : null)}
        {groups && wholeSetTicked(groups, ticks) ? <Notice tone="warn">Every photo in a set is ticked. Untick one to keep it.</Notice> : null}
        {any ? (
          <Button
            label={deleteLabel(chosen.count, chosen.bytes)}
            variant="danger"
            block
            busy={busy}
            disabled={chosen.count === 0}
            onPress={() => { void remove(chosen.uris); }}
            accessibilityHint="Android asks you to confirm before anything is moved to trash"
          />
        ) : null}
      </View>
      <Sheet visible={picked !== null} onClose={() => setPicked(null)} title="Photo">
        {picked ? <Image source={{ uri: picked }} resizeMethod="resize" resizeMode="contain" style={{ width: width - 2 * space.lg, height: width - 2 * space.lg }} accessibilityLabel="The photo you picked" /> : null}
        <Button label="Not a mistake" onPress={() => { if (picked) void dismiss([picked]); }} accessibilityHint="Stops suggesting this photo here" />
        <Button
          label="Open"
          variant="secondary"
          onPress={() => { if (picked) DesignMedia.open(picked).catch(() => Alert.alert("This photo can't be opened", 'It may have been deleted.')); }}
          accessibilityHint="Opens this photo in your photo viewer"
        />
      </Sheet>
    </Screen>
  );
}
