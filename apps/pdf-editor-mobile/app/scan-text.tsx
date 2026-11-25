import { Button, Empty, Field, Group, Header, Notice, Pill, Row, Screen, Sheet, space, Text } from '@apps-hub/ui';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import TextOcr, { allText, OCR_LANGUAGES, type OcrLanguage } from 'text-ocr';

import { loadOcrLanguage, saveOcrLanguage } from '../src/scan/ocr-language';

type State =
  | { type: 'idle' }
  | { type: 'denied' }
  | { type: 'reading' }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

// A quick text grab: nothing is saved, and the photo is deleted once it has been read.
export default function ScanTextScreen() {
  const [state, setState] = useState<State>({ type: 'idle' });
  const [copied, setCopied] = useState(false);
  const [lang, setLang] = useState<OcrLanguage>(loadOcrLanguage);
  const langRef = useRef(lang); // scan() is memoised once, so it reads the choice from here
  const [picking, setPicking] = useState(false);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const scan = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setCopied(false);
    let uri: string | undefined;
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return setState({ type: 'denied' });
      const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] });
      uri = shot.assets?.[0]?.uri;
      if (shot.canceled || !uri) return setState({ type: 'idle' });
      setState({ type: 'reading' });
      const result = await TextOcr.recognizeFile(uri, langRef.current);
      setState({ type: 'done', text: allText(result.lines) });
    } catch (err) {
      setState({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    void scan();
    return () => clearTimeout(timer.current);
  }, [scan]);

  const copy = async (text: string) => {
    try {
      await TextOcr.copy(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setState({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const choose = (next: OcrLanguage) => {
    langRef.current = next;
    setLang(next);
    saveOcrLanguage(next);
    setPicking(false);
  };
  const chosen = OCR_LANGUAGES.find((l) => l.id === lang)!;

  const again = <Button label="Scan again" variant="secondary" onPress={() => void scan()} />;

  return (
    <Screen scroll>
      <Header title="Scan text" subtitle="Take a photo of some text, then copy it." trailing={<Button label="Done" size="sm" variant="ghost" onPress={() => router.back()} />} />
      <Group>
        <Row title="Language of the text" subtitle={chosen.label} trailing={<Button label="Change" size="sm" variant="secondary" onPress={() => setPicking(true)} />} />
      </Group>
      <Sheet visible={picking} onClose={() => setPicking(false)} title="Language of the text">
        <Group footer="Pick the language before you take the photo. Nothing leaves this phone.">
          {OCR_LANGUAGES.map((l) => (
            <Row key={l.id} title={l.label} subtitle={l.hint} trailing={l.id === lang ? <Pill label="Chosen" tone="ok" /> : undefined} onPress={() => choose(l.id)} accessibilityLabel={l.id === lang ? `${l.label}, chosen` : l.label} />
          ))}
        </Group>
      </Sheet>
      {state.type === 'idle' && (
        <Empty title="Nothing scanned yet" body="Point the camera at the text and take a photo." action={<Button label="Scan text" onPress={() => void scan()} />} />
      )}
      {state.type === 'denied' && (
        <Notice
          tone="warn"
          title="Camera access is off"
          action={
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="Open settings" size="sm" onPress={() => void Linking.openSettings()} />
              <Button label="Scan again" size="sm" variant="secondary" onPress={() => void scan()} />
            </View>
          }
        >
          PDF Editor needs the camera to read text. Open Settings, choose Permissions, turn on Camera, then come back and scan again.
        </Notice>
      )}
      {state.type === 'reading' && (
        <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xxxl }}>
          <ActivityIndicator />
          <Text tone="muted">Reading text…</Text>
        </View>
      )}
      {state.type === 'error' && (
        <Notice tone="danger" title="Could not read the text" action={again}>
          {`${state.message} Take the photo again with more light, or check that the phone has free space.`}
        </Notice>
      )}
      {state.type === 'done' && state.text === '' && (
        <Notice tone="warn" action={again}>
          {`No text found. Hold the phone steady, add light and try again. If the text is in another language, change the language first (now ${chosen.label}).`}
        </Notice>
      )}
      {state.type === 'done' && state.text !== '' && (
        <>
          <Field
            label="Scanned text"
            hint="Touch and hold to select part of it, or fix a mistake first."
            value={state.text}
            onChangeText={(text) => setState({ type: 'done', text })}
            multiline
            autoCorrect={false}
            style={{ minHeight: 240, paddingTop: space.md, textAlignVertical: 'top' }}
          />
          <View style={{ gap: space.md }}>
            <Button label={copied ? 'Copied' : 'Copy all'} onPress={() => void copy(state.text)} />
            {again}
          </View>
        </>
      )}
    </Screen>
  );
}
