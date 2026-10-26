import { Button, Empty, fonts, space, Text, useTheme } from '@apps-hub/ui';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Asset } from 'expo-asset';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView, { type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { injectCommand, parseMessage } from '../src/editor/bridge';

// Survives hot reloads: on the ready handshake after a reload the editor is
// re-opened with this doc instead of stranding an empty page.
let lastDoc: { uri: string; name: string; append: boolean } | null = null;

async function readPdfBase64(uri: string) {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

export default function EditorScreen() {
  const params = useLocalSearchParams<{ uri?: string; name?: string }>();
  const { c } = useTheme();
  const [assetUri, setAssetUri] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [docName, setDocName] = useState(params.name ?? 'PDF Editor');
  const [sharing, setSharing] = useState(false);
  const webRef = useRef<WebView>(null);
  const picking = useRef(false);
  const sharingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (params.uri && params.name) lastDoc = { uri: params.uri, name: params.name, append: false };
  }, [params.uri, params.name]);

  // The inlined editor page ships as a metro asset; downloadAsync pins localUri.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const asset = Asset.fromModule(require('../assets/editor/editor.html') as number);
        await asset.downloadAsync();
        if (alive) setAssetUri(asset.localUri ?? asset.uri);
      } catch (err) {
        if (alive) setAssetError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { alive = false; };
  }, []);

  const reopenDoc = useCallback(async () => {
    const doc = lastDoc;
    if (!doc) return;
    try {
      const base64 = await readPdfBase64(doc.uri);
      injectCommand(webRef, { type: 'open', name: doc.name, base64, append: doc.append });
    } catch (err) {
      injectCommand(webRef, { type: 'toast', message: 'Could not re-read that file: ' + (err instanceof Error ? err.message : String(err)) });
    }
  }, []);

  const onMessage = useCallback((ev: WebViewMessageEvent) => {
    const msg = parseMessage(ev.nativeEvent.data);
    if (!msg) return;
    switch (msg.type) {
      case 'ready':
        void reopenDoc();
        break;
      case 'documentLoaded':
        if (msg.ok) {
          if (msg.name) setDocName(msg.name);
        } else {
          Alert.alert('Could not open PDF', msg.error ?? 'Unknown error', [{ text: 'OK' }, { text: 'Back', onPress: () => router.back() }]);
        }
        break;
      case 'pickPdf':
        void (async () => {
          if (picking.current) return;
          picking.current = true;
          try {
            const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'] });
            const asset = res.assets?.[0];
            if (!res.canceled && asset) {
              lastDoc = { uri: asset.uri, name: asset.name, append: msg.append };
              setDocName(asset.name);
              injectCommand(webRef, { type: 'open', name: asset.name, base64: await readPdfBase64(asset.uri), append: msg.append });
            }
          } catch (err) {
            injectCommand(webRef, { type: 'toast', message: 'Pick failed: ' + (err instanceof Error ? err.message : String(err)) });
          } finally {
            picking.current = false;
          }
        })();
        break;
      case 'pickImage':
        void (async () => {
          const done = (ok: boolean, base64?: string) =>
            injectCommand(webRef, { type: 'image', ok, base64, pageIndex: msg.pageIndex, x: msg.x, y: msg.y });
          const res = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            // JPEG instead of HEIC, so the WebView canvas can re-encode it
            preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
            quality: 1,
          });
          const asset = res.assets?.[0];
          if (res.canceled || !asset) return done(false);
          try {
            done(true, await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 }));
          } catch (err) {
            injectCommand(webRef, { type: 'toast', message: 'Could not read the image: ' + (err instanceof Error ? err.message : String(err)) });
            done(false);
          }
        })();
        break;
      case 'save':
        if (sharingTimer.current) clearTimeout(sharingTimer.current);
        setSharing(false);
        void (async () => {
          try {
            // name is built in-page as "<file>-edited.pdf"; keep it flat for the cache dir
            const fileUri = FileSystem.cacheDirectory! + msg.name.replace(/[\\/]+/g, '-');
            await FileSystem.writeAsStringAsync(fileUri, msg.base64, { encoding: FileSystem.EncodingType.Base64 });
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(fileUri, { mimeType: 'application/pdf', dialogTitle: 'Share edited PDF', UTI: 'com.adobe.pdf' });
              injectCommand(webRef, { type: 'toast', message: `Ready to share: ${msg.name}` });
            } else {
              injectCommand(webRef, { type: 'toast', message: `Saved in app cache: ${msg.name}` });
            }
          } catch (err) {
            injectCommand(webRef, { type: 'toast', message: 'Save failed: ' + (err instanceof Error ? err.message : String(err)) });
          }
        })();
        break;
    }
  }, [reopenDoc]);

  const leave = useCallback(() => {
    Alert.alert('Leave editor?', 'Unsaved changes will be lost.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => router.back() },
    ]);
  }, []);

  // Share = the in-page Save button through the bridge; spin while building.
  const share = useCallback(() => {
    if (sharing) return;
    setSharing(true);
    webRef.current?.injectJavaScript('document.querySelector("#save").click(); true;');
    sharingTimer.current = setTimeout(() => setSharing(false), 20000);
  }, [sharing]);

  const onWebViewError = useCallback((e: { nativeEvent: { description?: string } }) => {
    setAssetError(e.nativeEvent.description ?? 'The editor page failed to load.');
  }, []);

  // Mirror of the desktop shell's will-navigate guard: only our own page may load.
  const allowLoad = useCallback(
    (req: WebViewNavigation) =>
      (req.url ?? '').startsWith('file:') || (req.url ?? '').startsWith('about:'),
    [],
  );

  return (
    <SafeAreaView style={[host.host, { backgroundColor: c.surface }]} edges={['top', 'left', 'right']}>
      <View style={[host.bar, { borderBottomColor: c.line }]}>
        <View style={host.side}>
          <Pressable
            onPress={leave}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [host.iconBtn, pressed && { backgroundColor: c.raised }]}
          >
            <Ionicons name="chevron-back" size={24} color={c.text} />
          </Pressable>
        </View>
        <Text variant="bodyStrong" align="center" numberOfLines={1} style={host.docName}>
          {docName}
        </Text>
        <View style={[host.side, host.sideEnd]}>
          {sharing ? (
            <ActivityIndicator size="small" color={c.accent} accessibilityLabel="Preparing the PDF" style={host.iconBtn} />
          ) : (
            <Pressable
              onPress={share}
              accessibilityRole="button"
              accessibilityLabel="Share"
              accessibilityHint="Saves the edited PDF and opens the share sheet"
              style={({ pressed }) => [host.shareBtn, pressed && { backgroundColor: c.raised }]}
            >
              <Ionicons name="share-outline" size={20} color={c.accent} />
              <Text variant="meta" tone="accent" style={{ fontFamily: fonts.semibold }}>Share</Text>
            </Pressable>
          )}
        </View>
      </View>
      {assetError ? (
        <View style={[host.center, { backgroundColor: c.bg }]}>
          <Empty
            title="The editor didn't load"
            body={`${assetError} Go back and open the file again.`}
            action={<Button label="Go back" variant="secondary" onPress={() => router.back()} />}
          />
        </View>
      ) : assetUri ? (
        <WebView
          ref={webRef}
          source={{ uri: assetUri }}
          onMessage={onMessage}
          onError={onWebViewError}
          originWhitelist={['*']}
          allowFileAccess
          textZoom={100}
          androidLayerType="hardware"
          onShouldStartLoadWithRequest={allowLoad}
          style={host.web}
        />
      ) : (
        <View style={[host.center, { backgroundColor: c.bg }]}><ActivityIndicator size="large" color={c.accent} /></View>
      )}
    </SafeAreaView>
  );
}

const host = StyleSheet.create({
  host: { flex: 1 },
  bar: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.xs, minHeight: 52, flexDirection: 'row', alignItems: 'center' },
  // equal-width sides keep the file name centred on the bar
  side: { width: 96, flexDirection: 'row' },
  sideEnd: { justifyContent: 'flex-end' },
  iconBtn: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  shareBtn: { minHeight: 44, paddingHorizontal: space.md, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  docName: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  web: { flex: 1, backgroundColor: 'transparent' },
});
