import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Button, Group, Header, Notice, Row, Screen, Text, ThemeProvider, palette } from '@apps-hub/ui';
import ClipboardCore, { type Clip } from 'clipboard-core';
import { clipSubtitle, clipTitle } from './src/rows';
import { SwipeToDelete } from './src/SwipeToDelete';

const LIMIT = 200;
const UNDO_MS = 5000;

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

  const now = Date.now();
  const shown = clips.filter((clip) => clip.id !== pending?.id);
  return (
    <Screen scroll>
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
      <Group title="History">
        {shown.length === 0 ? (
          <Row title="Nothing saved yet" subtitle="Copy something in any app and it appears here." />
        ) : (
          shown.map((clip) => (
            <SwipeToDelete
              key={clip.id}
              label={`${clipTitle(clip)}, ${clipSubtitle(clip, now)}`}
              onPress={() => copy(clip)}
              onDelete={() => remove(clip)}
            >
              <Row title={<Text numberOfLines={3}>{clipTitle(clip)}</Text>} subtitle={clipSubtitle(clip, now)} onPress={() => copy(clip)} />
            </SwipeToDelete>
          ))
        )}
      </Group>
    </Screen>
  );
}
