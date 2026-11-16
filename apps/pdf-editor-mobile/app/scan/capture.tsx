import { Button, Notice, Pill, Segmented, Text, radius, space, useTheme } from '@apps-hub/ui';
import { useIsFocused } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { PdfScan, ScanCameraView, type CameraErrorEvent, type CaptureEvent, type QuadEvent, type ScanCameraViewRef, type ScanHint } from 'pdf-scan';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '../../src/library/icon-button';
import { discardSession, loadSession, openSession, saveSession, sessionDir } from '../../src/scan/session';
import { fileNameOf, newPage, type ScanSession } from '../../src/scan/session-data';

type Access = 'checking' | 'granted' | 'ask' | 'blocked';

function hintText(hint: ScanHint, auto: boolean, count: number, saving: boolean) {
  switch (hint) {
    case 'searching':
      return 'Looking for the page edges';
    case 'hold':
      return auto ? 'Hold steady' : 'Page found. Tap the shutter.';
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

  const onQuad = (e: { nativeEvent: QuadEvent }) => {
    const next = e.nativeEvent.hint;
    if (next === 'captured' && hint !== 'captured') setSaving(true);
    setHint(next);
  };

  const onCapture = (e: { nativeEvent: CaptureEvent }) => {
    const { uri, quad } = e.nativeEvent;
    const next = { ...session.current, pages: [...session.current.pages, newPage(fileNameOf(uri), quad)] };
    setError(null);
    setSaving(false);
    try {
      saveSession(next);
    } catch (err) {
      // The photo is already in scan-session/, so the next load still finds it.
      setError(`The page list couldn't be saved: ${err instanceof Error ? err.message : String(err)}`);
    }
    session.current = next;
    setCount(next.pages.length);
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

  const shutter = () => {
    void Haptics.selectionAsync();
    setSaving(true);
    camera.current?.capture().catch((err: unknown) => setError(`The photo wasn't taken: ${err instanceof Error ? err.message : String(err)}`));
  };

  const blocked = access === 'ask' || access === 'blocked';

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {access === 'granted' ? (
        <ScanCameraView
          ref={camera}
          style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}
          active={focused && appActive}
          autoCapture={auto}
          torch={torch}
          accentColor={c.accent}
          sessionDir={sessionDir().uri}
          onQuad={onQuad}
          onCapture={onCapture}
          onCameraError={onCameraError}
        />
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
        {access === 'granted' ? (
          <View style={{ alignSelf: 'center', backgroundColor: c.surface, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs }}>
            <Text variant="meta" accessibilityLiveRegion="polite">
              {hintText(hint, auto, count, saving)}
            </Text>
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
            PDF Editor needs it to scan pages.
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
          disabled={access !== 'granted'}
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          accessibilityState={{ disabled: access !== 'granted' }}
          style={({ pressed }) => ({
            width: 72,
            height: 72,
            borderRadius: 36,
            borderWidth: 4,
            borderColor: c.text,
            backgroundColor: pressed ? c.accentSoft : c.accent,
            opacity: access === 'granted' ? 1 : 0.4,
          })}
        />
        <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Button label="Done" onPress={leave} disabled={count === 0} />
        </View>
      </View>
    </View>
  );
}
