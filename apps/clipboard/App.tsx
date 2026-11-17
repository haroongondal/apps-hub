import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Empty, Header, Notice, RecordMenu, Row, Screen, Text, ThemeProvider, confirmAction, palette, radius, space, useTheme } from '@apps-hub/ui';
import ClipboardCore, { type Clip } from 'clipboard-core';
import { clipSubtitle, clipTitle } from './src/rows';
import { SwipeToDelete } from './src/SwipeToDelete';

const LIMIT = 200;
const UNDO_MS = 5000;
const NOTICE_MS = 4000;

export default function App() {
  return (
    <ThemeProvider brand="clipboard">
      <Home />
    </ThemeProvider>
  );
}

function Home() {
  const [service, setService] = useState(() => ClipboardCore.getServiceState());
  const [clips, setClips] = useState<Clip[]>(() => ClipboardCore.recent(LIMIT));
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Clip | null>(null);
  const pendingRef = useRef<Clip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const reload = useCallback(() => setClips(ClipboardCore.recent(LIMIT)), []);
  // The row disappears at once; the clip is only removed when Undo times out or the app leaves the screen.
  const commit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const clip = pendingRef.current;
    if (!clip) return;
    pendingRef.current = null;
    setPending(null);
    ClipboardCore.remove(clip.id);
    reload();
  }, [reload]);
  const refresh = useCallback(() => {
    setService(ClipboardCore.getServiceState());
    ClipboardCore.captureNow();
    reload();
  }, [reload]);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? refresh() : commit()));
    return () => sub.remove();
  }, [refresh, commit]);
  useEffect(() => {
    const sub = ClipboardCore.addListener('onClip', reload);
    return () => sub.remove();
  }, [reload]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    ClipboardCore.setPalettes(JSON.stringify({ light: palette('clipboard', 'light'), dark: palette('clipboard', 'dark') }));
  }, []);

  const copy = (clip: Clip) => {
    setNotice(ClipboardCore.copy(clip.id) ? 'Copied. Long-press a text field to paste.' : 'This clip has no text to copy back yet.');
    reload();
  };
  const remove = (clip: Clip) => {
    commit();
    pendingRef.current = clip;
    setPending(clip);
    setNotice(null);
    timer.current = setTimeout(commit, UNDO_MS);
  };
  const undo = () => {
    if (timer.current) clearTimeout(timer.current);
    pendingRef.current = null;
    setPending(null);
  };
  const clearAll = () => {
    commit();
    ClipboardCore.clearAll();
    reload();
    setNotice('All clips cleared.');
  };
  const askClearAll = () =>
    confirmAction({
      title: 'Clear all clips?',
      message: `This removes ${shown.length} saved ${shown.length === 1 ? 'clip' : 'clips'} from this phone. It can\u2019t be undone.`,
      confirmLabel: 'Clear all',
      onConfirm: clearAll,
    });

  const now = Date.now();
  const shown = clips.filter((clip) => clip.id !== pending?.id);
  const header = (
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.xl }}>
      <Header title="Clipboard" subtitle="Everything you copy, kept for 30 days" />
      {!service.enabled ? (
        <Notice
          tone="warn"
          title="Capture is off"
          action={<Button label="Turn on" size="sm" onPress={ClipboardCore.openAccessibilitySettings} />}
        >
          Turn on Clipboard in Accessibility settings, under Downloaded apps, so copies are saved while you use other apps.
        </Notice>
      ) : !service.connected ? (
        <Notice tone="warn" title="Capture isn't running">
          Clipboard is switched on but not connected. Turn it off and on again in Accessibility settings.
        </Notice>
      ) : null}
      {pending ? (
        <Notice action={<Button label="Undo" variant="secondary" size="sm" onPress={undo} />}>Clip deleted.</Notice>
      ) : notice ? (
        <Notice tone="ok">{notice}</Notice>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs, minHeight: 32 }}>
        <Text variant="caption" tone="muted" accessibilityRole="header">
          History
        </Text>
        {shown.length > 0 ? <Button label="Clear all" variant="ghost" size="sm" tone="danger" onPress={askClearAll} /> : null}
      </View>
    </View>
  );

  return (
    <Screen>
      <FlatList
        data={shown}
        keyExtractor={(clip) => String(clip.id)}
        ListHeaderComponent={header}
        ListEmptyComponent={<Empty title="Nothing saved yet" body="Copy something in any app and it appears here." />}
        ItemSeparatorComponent={GroupSeparator}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxxl }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item, index }) => (
          <GroupItem first={index === 0} last={index === shown.length - 1}>
            <SwipeToDelete
              label={`${clipTitle(item)}, ${clipSubtitle(item, now)}`}
              onPress={() => copy(item)}
              onDelete={() => remove(item)}
            >
              <Row
                title={<Text numberOfLines={3}>{clipTitle(item)}</Text>}
                subtitle={clipSubtitle(item, now)}
                onPress={() => copy(item)}
                trailing={
                  <RecordMenu
                    title={clipTitle(item).slice(0, 40)}
                    accessibilityLabel="More actions for this clip"
                    actions={[
                      { label: 'Copy', onPress: () => copy(item) },
                      { label: 'Delete', onPress: () => remove(item) },
                    ]}
                  />
                }
              />
            </SwipeToDelete>
          </GroupItem>
        )}
      />
    </Screen>
  );
}

const groupEdge = (c: ReturnType<typeof useTheme>['c']) => ({
  borderColor: c.line,
  borderLeftWidth: 1,
  borderRightWidth: 1,
  marginHorizontal: space.lg,
  backgroundColor: c.surface,
});

function GroupItem({ first, last, children }: { first: boolean; last: boolean; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View
      style={[
        { ...groupEdge(c), overflow: 'hidden' },
        first && { borderTopWidth: 1, borderTopLeftRadius: radius.group, borderTopRightRadius: radius.group },
        last && { borderBottomWidth: 1, borderBottomLeftRadius: radius.group, borderBottomRightRadius: radius.group },
      ]}
    >
      {children}
    </View>
  );
}

function GroupSeparator() {
  const { c } = useTheme();
  return (
    <View style={groupEdge(c)}>
      <View style={{ height: 1, backgroundColor: c.line, marginLeft: space.lg }} />
    </View>
  );
}
