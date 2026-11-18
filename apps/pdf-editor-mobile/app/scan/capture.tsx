import { Button, Notice, Pill, Segmented, Text, radius, space, useTheme } from '@apps-hub/ui';
import { useIsFocused } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { PdfScan, ScanCameraView, type CameraErrorEvent, type CaptureEvent, type QuadEvent, type ScanCameraViewRef, type ScanHint } from 'pdf-scan';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '../../src/library/icon-button';
import { canSwitchMode, nextSide, sortCardPages } from '../../src/scan/capture-rules';
import { discardSession, loadSession, openSession, saveSession, sessionDir } from '../../src/scan/session';
import { fileNameOf, newPage, type ScanMode, type ScanSession } from '../../src/scan/session-data';

type Access = 'checking' | 'granted' | 'ask' | 'blocked';

function hintText(hint: ScanHint, auto: boolean, count: number, saving: boolean, card: boolean) {
  switch (hint) {
    case 'searching':
      return card ? 'Looking for the card edges' : 'Looking for the page edges';
    case 'hold':
      return auto ? 'Hold steady' : `${card ? 'Card' : 'Page'} found. Tap the shutter.`;
    case 'blurry':
      return 'Too blurry, hold still';
    case 'focusing':
      return 'Focusing';
    case 'captured':
      return saving ? 'Taking the photo' : `Captured page ${count}`;
  }
}

export default function CaptureScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const camera = useRef<ScanCameraViewRef>(null);
  const [initial] = useState<ScanSession>(() => loadSession() ?? openSession(null));
  const session = useRef(initial);
  const [count, setCount] = useState(initial.pages.length);
  const [mode, setMode] = useState<ScanMode>(initial.mode);
  const [side, setSide] = useState(() => nextSide(initial.mode, initial.pages));
  const [lastUri, setLastUri] = useState<string | null>(() => {
    const last = initial.pages[initial.pages.length - 1];
    return last ? new File(sessionDir(), last.file).uri : null;
  });
  const [saving, setSaving] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [access, setAccess] = useState<Access>('checking');
  const [auto, setAuto] = useState(true);
  const [torch, setTorch] = useState(false);
  const [hint, setHint] = useState<ScanHint>('searching');
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async (ask: boolean) => {
    try {
      let p = await PdfScan.getCameraPermission();
      if (!p.granted && p.canAskAgain && ask) p = await PdfScan.requestCameraPermission();
      setAccess(p.granted ? 'granted' : p.canAskAgain ? 'ask' : 'blocked');
    } catch (e) {
      setError(`The camera permission couldn't be checked: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    void check(true);
    const sub = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
      if (state === 'active') void check(false);
    });
    return () => sub.remove();
  }, [check]);

  // Review can delete or retake pages, so the list is re-read when this screen comes back.
  useFocusEffect(
    useCallback(() => {
      const fresh = loadSession() ?? openSession(session.current.folderId);
      session.current = fresh;
      setCount(fresh.pages.length);
      setMode(fresh.mode);
      setSide(nextSide(fresh.mode, fresh.pages));
      const last = fresh.pages[fresh.pages.length - 1];
      setLastUri(last ? new File(sessionDir(), last.file).uri : null);
    }, []),
  );

  const onQuad = (e: { nativeEvent: QuadEvent }) => {
    const next = e.nativeEvent.hint;
    if (next === 'captured' && hint !== 'captured') setSaving(true);
    setHint(next);
  };

  const onCapture = (e: { nativeEvent: CaptureEvent }) => {
    const { uri, quad } = e.nativeEvent;
    const taking = nextSide(session.current.mode, session.current.pages);
    setSaving(false);
    if (taking === 'full') {
      try {
        new File(uri).delete();
      } catch {
        // a stray capture is picked up as a page, so say so
        setError('A card has two sides. Tap Done, then delete the extra photo.');
      }
      return;
    }
    const added = [...session.current.pages, newPage(fileNameOf(uri), quad, taking)];
    const next = { ...session.current, pages: session.current.mode === 'card' ? sortCardPages(added) : added };
    setError(null);
    try {
      saveSession(next);
    } catch (err) {
      // The photo is already in scan-session/, so the next load still finds it.
      setError(`The page list couldn't be saved: ${err instanceof Error ? err.message : String(err)}`);
    }
    session.current = next;
    setCount(next.pages.length);
    setSide(nextSide(next.mode, next.pages));
    setLastUri(uri);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    AccessibilityInfo.announceForAccessibility(`Captured page ${next.pages.length}`);
  };

  const onCameraError = (e: { nativeEvent: CameraErrorEvent }) => {
    setSaving(false);
    if (e.nativeEvent.code === 'permission') void check(false);
    else setError(e.nativeEvent.message);
  };

  const leave = () => {
    if (session.current.pages.length === 0) discardSession();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const done = () => router.push('/scan/review');

  const switchMode = (k: ScanMode) => {
    if (!canSwitchMode(session.current) || k === session.current.mode) return;
    const next = { ...session.current, mode: k, sheet: false };
    try {
      saveSession(next);
    } catch (err) {
      setError(`The mode couldn't be saved: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    session.current = next;
    setMode(k);
    setSide(nextSide(k, next.pages));
  };

  const shutter = () => {
    if (side === 'full') return;
    void Haptics.selectionAsync();
    setSaving(true);
    camera.current?.capture().catch((err: unknown) => setError(`The photo wasn't taken: ${err instanceof Error ? err.message : String(err)}`));
  };

  const blocked = access === 'ask' || access === 'blocked';
  const card = mode === 'card';
  const full = side === 'full';
  const locked = count > 0;
  const sideHint = full ? 'A card has two sides. Tap Done.' : side === 'back' ? 'Back of the card' : 'Front of the card';

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {access === 'granted' ? (
        <ScanCameraView
          ref={camera}
          style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}
          active={focused && appActive}
          autoCapture={auto && !full}
          cardMode={card}
          torch={torch}
          accentColor={c.accent}
          sessionDir={sessionDir().uri}
          onQuad={onQuad}
          onCapture={onCapture}
          onCameraError={onCameraError}
        />
      ) : null}

      {card && access === 'granted' ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <View style={{ width: '80%', aspectRatio: 1.586, borderRadius: 12, borderWidth: 2, borderColor: c.accent }} />
        </View>
      ) : null}

      <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: space.lg, gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <IconButton icon="close" label="Close" onPress={leave} />
          <IconButton icon={torch ? 'flash' : 'flash-outline'} label={torch ? 'Turn the torch off' : 'Turn the torch on'} onPress={() => setTorch(!torch)} />
          <View style={{ flex: 1 }}>
            <Segmented<'auto' | 'manual'>
              accessibilityLabel="Capture"
              options={[
                { key: 'auto', label: 'Auto' },
                { key: 'manual', label: 'Manual' },
              ]}
              value={auto ? 'auto' : 'manual'}
              onChange={(k) => setAuto(k === 'auto')}
            />
          </View>
        </View>
        <View pointerEvents={locked ? 'none' : 'auto'} style={{ opacity: locked ? 0.5 : 1 }}>
          <Segmented<ScanMode>
            accessibilityLabel={locked ? 'Scan type, locked while the scan has pages' : 'Scan type'}
            options={[
              { key: 'document', label: 'Document' },
              { key: 'card', label: 'Card' },
            ]}
            value={mode}
            onChange={switchMode}
          />
        </View>
        {access === 'granted' ? (
          <View style={{ alignSelf: 'center', backgroundColor: c.surface, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs, alignItems: 'center' }}>
            {card ? (
              <Text variant="bodyStrong" accessibilityLiveRegion="polite">
                {sideHint}
              </Text>
            ) : null}
            {full ? null : (
              <Text variant="meta" accessibilityLiveRegion="polite">
                {hintText(hint, auto, count, saving, card)}
              </Text>
            )}
          </View>
        ) : null}
        {blocked ? (
          <Notice
            tone="warn"
            title="Camera access is off"
            action={
              access === 'blocked' ? (
                <Button label="Open settings" size="sm" variant="secondary" onPress={() => void Linking.openSettings()} />
              ) : (
                <Button label="Allow camera" size="sm" variant="secondary" onPress={() => void check(true)} />
              )
            }
          >
            Nexus needs it to scan pages.
          </Notice>
        ) : null}
        {error ? (
          <Notice tone="danger" title="Something went wrong" action={<Button label="Dismiss" size="sm" variant="secondary" onPress={() => setError(null)} />}>
            {error}
          </Notice>
        ) : null}
      </View>

      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: insets.bottom + space.lg,
          paddingHorizontal: space.lg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flex: 1, alignItems: 'flex-start', gap: space.xs }} accessible accessibilityLabel={`${count} ${count === 1 ? 'page' : 'pages'} captured`}>
          {lastUri ? <Image source={{ uri: lastUri }} style={{ width: 48, height: 64, borderRadius: radius.control / 2 }} contentFit="cover" /> : null}
          <Pill label={`${count} ${count === 1 ? 'page' : 'pages'}`} tone={count > 0 ? 'accent' : 'neutral'} />
        </View>
        <Pressable
          onPress={shutter}
          disabled={access !== 'granted' || full}
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          accessibilityState={{ disabled: access !== 'granted' || full }}
          style={({ pressed }) => ({
            width: 72,
            height: 72,
            borderRadius: 36,
            borderWidth: 4,
            borderColor: c.text,
            backgroundColor: pressed ? c.accentSoft : c.accent,
            opacity: access === 'granted' && !full ? 1 : 0.4,
          })}
        />
        <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Button label="Done" onPress={done} disabled={count === 0} />
        </View>
      </View>
    </View>
  );
}
