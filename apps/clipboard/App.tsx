import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, FlatList, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Empty, Group, Header, Notice, RecordMenu, Row, Screen, Segmented, Text, ThemeProvider, confirmAction, palette, radius, space, useTheme } from '@apps-hub/ui';
import ClipboardCore, { type Clip } from 'clipboard-core';
import { KEEP_CHOICES, clipSubtitle, clipTitle, keepLabel } from './src/rows';
import { inflowOutcomeMessage, parseInflowOutcome, type InflowTodo } from './src/inflow';
import { smartActions, type SmartAction } from './src/smart';
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
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const [keep, setKeep] = useState(() => ClipboardCore.getRetentionDays());
  const [nexusPinned, setNexusPinned] = useState(() => ClipboardCore.getNexusReadsPinned());
  const [pending, setPending] = useState<Clip | null>(null);
  const pendingRef = useRef<Clip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const { c } = useTheme();

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
    const copied = ClipboardCore.copy(clip.id);
    setNotice(copied ? { text: 'Copied. Long-press a text field to paste.', tone: 'ok' } : { text: 'This clip has no text to copy back yet.', tone: 'warn' });
    reload();
  };
  const togglePin = (clip: Clip) => {
    ClipboardCore.setPinned(clip.id, !clip.pinned);
    reload();
    setNotice({ text: clip.pinned ? 'Unpinned. It goes after the time you keep clips for.' : 'Pinned. It stays until you delete it.', tone: 'ok' });
  };
  const changeKeep = (key: string) => {
    const days = Number(key);
    ClipboardCore.setRetentionDays(days);
    setKeep(days);
    reload();
  };
  // Every smart action runs only from this tap; nothing opens on its own.
  const runAction = (action: SmartAction) => {
    if (action.copy) {
      ClipboardCore.copyText(action.copy);
      setNotice({ text: 'IBAN copied. Long-press a text field to paste.', tone: 'ok' });
      return;
    }
    if (action.uri && ClipboardCore.openAction(action.uri)) return;
    setNotice({ text: 'No app on this phone can open that. Copy the clip and paste it where you need it.', tone: 'warn' });
  };
  // Only from this tap, in this screen: Inflow shows its own "Add to-do?" screen and adds nothing until the owner taps Add there.
  const addToInflow = async (todo: InflowTodo) => {
    let raw: unknown;
    try {
      raw = await ClipboardCore.addToInflow(todo.title, todo.note, todo.source);
    } catch {
      raw = 'refused';
    }
    const message = inflowOutcomeMessage(parseInflowOutcome(raw));
    if (message) setNotice(message);
  };
  const changeNexusPinned = (on: boolean) => {
    ClipboardCore.setNexusReadsPinned(on);
    setNexusPinned(ClipboardCore.getNexusReadsPinned());
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
    // Drop the pending delete without committing it: the native clearAll must see that clip as the newest, so it is the one dismissed.
    if (timer.current) clearTimeout(timer.current);
    pendingRef.current = null;
    setPending(null);
    ClipboardCore.clearAll();
    reload();
    setNotice({ text: 'All clips cleared.', tone: 'ok' });
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
      <Header title="Clipboard" subtitle={`Everything you copy, kept for ${keepLabel(keep)}`} />
      {!service.enabled ? (
        <Notice
          tone="warn"
          title="Capture is off"
          action={<Button label="Turn on" size="sm" onPress={ClipboardCore.openAccessibilitySettings} />}
        >
          Turn on Clipboard in Accessibility settings, under Downloaded apps, so copies are saved while you use other apps. If the
          switch is grey, open App info for Clipboard, tap the menu at the top right, then Allow restricted settings, and try again.
        </Notice>
      ) : !service.connected ? (
        <Notice
          tone="warn"
          title="Capture isn't running"
          action={<Button label="Open settings" size="sm" onPress={ClipboardCore.openAccessibilitySettings} />}
        >
          Clipboard is switched on but the phone stopped it. Turn on Autostart for Clipboard in the Security app, then turn
          Clipboard off and on again in Accessibility settings.
        </Notice>
      ) : null}
      {pending ? (
        <Notice action={<Button label="Undo" variant="secondary" size="sm" onPress={undo} />}>Clip deleted.</Notice>
      ) : notice ? (
        <Notice tone={notice.tone}>{notice.text}</Notice>
      ) : null}
      <View style={{ gap: space.sm }}>
        <Text variant="caption" tone="muted" accessibilityRole="header">
          Keep clips for
        </Text>
        <Segmented
          options={KEEP_CHOICES.map((d) => ({ key: String(d), label: keepLabel(d) }))}
          value={String(keep)}
          onChange={changeKeep}
          accessibilityLabel="Keep clips for"
        />
        <Text variant="meta" tone="muted">
          Pinned clips stay until you delete them. One-time codes go after 10 minutes.
        </Text>
      </View>
      <Group title="Other apps">
        <Row
          title="Let Nexus read my pinned clips"
          subtitle="Nexus can read the clips you pinned, and may send them to AI when you turn on Ask my life. Passwords, codes and pictures never go."
          trailing={
            <Switch
              value={nexusPinned}
              onValueChange={changeNexusPinned}
              accessibilityLabel="Let Nexus read my pinned clips"
              trackColor={{ false: c.line, true: c.accent }}
              thumbColor={nexusPinned ? c.surface : c.muted}
            />
          }
        />
      </Group>
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
        renderItem={({ item, index }) => {
          const smart = smartActions(item);
          const inflow = smart.flatMap((a) => (a.todo ? [a.todo] : []));
          const pinLabel = item.pinned ? 'Unpin' : 'Pin';
          return (
            <GroupItem first={index === 0} last={index === shown.length - 1}>
              <SwipeToDelete
                label={`${clipTitle(item)}, ${clipSubtitle(item, now)}`}
                onPress={() => copy(item)}
                onDelete={() => remove(item)}
                actions={[
                  { name: 'pin', label: pinLabel, run: () => togglePin(item) },
                  ...smart.map((a) => ({ name: a.kind, label: a.accessibilityLabel, run: () => runAction(a) })),
                  ...inflow.map((todo) => ({ name: 'inflow', label: 'Add to Inflow', run: () => addToInflow(todo) })),
                ]}
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
                        { label: pinLabel, onPress: () => togglePin(item) },
                        ...smart.map((a) => ({ label: a.label, onPress: () => runAction(a) })),
                        ...inflow.map((todo) => ({ label: 'Add to Inflow', onPress: () => addToInflow(todo) })),
                        { label: 'Delete', onPress: () => remove(item) },
                      ]}
                    />
                  }
                >
                  {smart.length > 0 ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                      {smart.map((a) => (
                        <Button
                          key={a.kind}
                          label={a.label}
                          accessibilityLabel={a.accessibilityLabel}
                          size="sm"
                          variant="secondary"
                          onPress={() => runAction(a)}
                        />
                      ))}
                      {inflow.map((todo) => (
                        <Button
                          key="inflow"
                          label="Add to Inflow"
                          accessibilityLabel={`Add a to-do in Inflow: ${todo.title}`}
                          size="sm"
                          variant="secondary"
                          onPress={() => addToInflow(todo)}
                        />
                      ))}
                    </View>
                  ) : null}
                </Row>
              </SwipeToDelete>
            </GroupItem>
          );
        }}
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
