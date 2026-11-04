import { Button, Empty, fonts, Text, useTheme } from '@apps-hub/ui';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Asset } from 'expo-asset';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView, { type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import DesignMedia from 'design-media';
import { injectCommand, parseMessage, replyError, replyOk, type PageEvent } from '../src/editor/bridge';
import {
  designTitle,
  readAutosave,
  recordSaved,
  writeAutosave,
  writeDesignMirror,
} from '../src/editor/files';

// Keeps the save→list dedup honest: a temporary name for the next mirror file.
const mirrorId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// True while the native file chooser is up, so a second openDesign cannot stack pickers.
const picking = { current: false };

export default function EditorScreen() {
  const params = useLocalSearchParams<{ name?: string }>();
  const { c } = useTheme();
  const [assetUri, setAssetUri] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [title, setTitle] = useState(params.name ?? 'Design Editor');
  const [dirty, setDirty] = useState(false);
  const webRef = useRef<WebView>(null);
  const docState = useRef({ title: params.name ?? 'Design Editor', dirty: false, filePath: null as string | null });

  // The inlined editor page ships as a metro asset; downloadAsync pins localUri (PDF Editor pattern).
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
    return () => {
      alive = false;
    };
  }, []);

  const onMessage = useCallback((ev: WebViewMessageEvent) => {
    const msg = parseMessage(ev.nativeEvent.data);
    if (!msg) return;
    void (async () => {
      try {
        switch (msg.type) {
          case 'readAutosave': {
            const record = await readAutosave();
            injectCommand(webRef, replyOk(msg.reqId, record));
            break;
          }
          case 'writeAutosave': {
            await writeAutosave(JSON.parse(msg.text));
            injectCommand(webRef, replyOk(msg.reqId, true));
            break;
          }
          case 'keepAutosave': {
            // A design the page could not restore gets one rescue copy before the next autosave
            // replaces the slot (main.js's autosave-keep does the same on the desktop). The reply
            // only ever shows up in the page's own toast.
            const info = await FileSystem.getInfoAsync(FileSystem.documentDirectory + 'autosave.json');
            if (!info.exists) {
              injectCommand(webRef, replyOk(msg.reqId, null));
              break;
            }
            const record = JSON.parse(await FileSystem.readAsStringAsync(FileSystem.documentDirectory + 'autosave.json')) as { doc?: string };
            const doc = typeof record?.doc === 'string' ? record.doc : JSON.stringify(record?.doc ?? null);
            const rescue = `rescue-${mirrorId()}`;
            await writeDesignMirror(rescue, doc);
            injectCommand(webRef, replyOk(msg.reqId, rescue));
            break;
          }
          case 'confirm': {
            Alert.alert('Design Editor', msg.message, [
              { text: 'Keep editing', style: 'cancel', onPress: () => injectCommand(webRef, replyOk(msg.reqId, false)) },
              { text: 'Discard', style: 'destructive', onPress: () => injectCommand(webRef, replyOk(msg.reqId, true)) },
            ]);
            break;
          }
          case 'saveFile': {
            const path = await saveFileMsg(msg);
            injectCommand(webRef, replyOk(msg.reqId, path));
            break;
          }
          case 'openDesign': {
            const design = await pickDesign();
            injectCommand(webRef, replyOk(msg.reqId, design));
            break;
          }
          case 'docState': {
            docState.current = { title: msg.title, dirty: msg.dirty, filePath: msg.filePath };
            setTitle(msg.title);
            setDirty(msg.dirty);
            break;
          }
        }
      } catch (err) {
        injectCommand(webRef, replyError((msg as { reqId?: string }).reqId ?? '0', err instanceof Error ? err.message : String(err)));
      }
    })();
  }, []);

  const leave = useCallback(() => {
    if (!docState.current.dirty) {
      router.back();
      return;
    }
    Alert.alert('Leave the editor?', `“${docState.current.title}” has changes that are not saved as a file yet. They stay available under Continue.`, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => router.back() },
    ]);
  }, []);

  const menu = useCallback((cmd: string) => {
    injectCommand(webRef, { type: 'menu', cmd });
  }, []);

  const allowLoad = useCallback(
    (req: WebViewNavigation) => (req.url ?? '').startsWith('file:') || (req.url ?? '').startsWith('about:'),
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
        <View style={host.docName}>
          <Text variant="bodyStrong" align="center" numberOfLines={1}>{title}</Text>
          {dirty ? <View style={[host.dot, { backgroundColor: c.accent }]} accessibilityLabel="Not saved yet" /> : null}
        </View>
        <View style={[host.side, host.sideEnd]}>
          <Pressable onPress={() => menu('save')} accessibilityRole="button" accessibilityLabel="Save" style={({ pressed }) => [host.pillBtn, pressed && { backgroundColor: c.raised }]}>
            <Ionicons name="save-outline" size={20} color={c.accent} />
            <Text variant="meta" tone="accent" style={{ fontFamily: fonts.semibold }}>Save</Text>
          </Pressable>
          <Pressable onPress={() => menu('export')} accessibilityRole="button" accessibilityLabel="Save image" accessibilityHint="Choose a format and size, then save the image" style={({ pressed }) => [host.pillBtn, pressed && { backgroundColor: c.raised }]}>
            <Ionicons name="download-outline" size={20} color={c.accent} />
          </Pressable>
        </View>
      </View>

      {assetError ? (
        <View style={[host.center, { backgroundColor: c.bg }]}>
          <Empty
            title="The editor didn't load"
            body="Go back and open the design again."
            action={<Button label="Go back" variant="secondary" onPress={() => router.back()} />}
          />
        </View>
      ) : assetUri ? (
        <View style={host.work}>
          <WebView
            ref={webRef}
            source={{ uri: assetUri }}
            onMessage={onMessage}
            originWhitelist={['*']}
            allowFileAccess
            textZoom={100}
            androidLayerType="hardware"
            overScrollMode="never"
            hideKeyboardAccessoryView
            onShouldStartLoadWithRequest={allowLoad}
            style={host.web}
            showsVerticalScrollIndicator={false}
          />
        </View>
      ) : (
        <View style={[host.center, { backgroundColor: c.bg }]}><ActivityIndicator size="large" color={c.accent} /></View>
      )}

      {assetUri && !assetError ? (
        <View style={[host.toolbar, { borderTopColor: c.line }]}>
          {(
            [
              ['undo', 'arrow-undo-outline', 'Undo'],
              ['redo', 'arrow-redo-outline', 'Redo'],
              ['duplicate', 'copy-outline', 'Duplicate the selected item'],
              ['zoomOut', 'remove-outline', 'Zoom out'],
              ['zoomIn', 'add-outline', 'Zoom in'],
              ['zoomFit', 'resize-outline', 'Fit the design on the screen'],
            ] as const
          ).map(([cmd, icon, label]) => (
            <Pressable
              key={cmd}
              onPress={() => menu(cmd)}
              accessibilityRole="button"
              accessibilityLabel={label}
              style={({ pressed }) => [host.toolBtn, pressed && { backgroundColor: c.raised }]}
            >
              <Ionicons name={icon} size={22} color={c.text} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

// saveFile json → a real file in Documents/Design Editor, mirrored for the Designs list.
// Everything else crosses as bytes already verified small (30 MB cap page-side).
async function saveFileMsg(msg: Extract<PageEvent, { type: 'saveFile' }>): Promise<string> {
  const path = msg.ext === 'json'
    ? await DesignMedia.saveJson(msg.name, msg.text ?? '', msg.filePath ?? null)
    : await DesignMedia.saveExport(msg.name, msg.ext, msg.base64 ?? '');
  if (msg.ext === 'json') {
    const name = designTitle(path);
    const id = await recordSaved({ id: mirrorId(), name, path });
    await writeDesignMirror(id, msg.text ?? '');
  }
  return path;
}

async function pickDesign(): Promise<{ text: string; filePath: string } | null> {
  if (picking.current) return null;
  picking.current = true;
  try {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/json'],
      copyToCacheDirectory: false,
      multiple: false,
    });
    const asset = res.assets?.[0];
    if (res.canceled || !asset) return null;
    const text = await FileSystem.readAsStringAsync(asset.uri);
    // the page's parseDoc is the strict validator; only obvious garbage is filtered here
    JSON.parse(text);
    return { text, filePath: asset.name };
  } finally {
    picking.current = false;
  }
}

const host = StyleSheet.create({
  host: { flex: 1 },
  bar: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4, minHeight: 52, flexDirection: 'row', alignItems: 'center' },
  // equal-width sides keep the file name centred on the bar (PDF Editor pattern)
  side: { width: 120, flexDirection: 'row' },
  sideEnd: { justifyContent: 'flex-end' },
  iconBtn: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pillBtn: { minHeight: 44, paddingHorizontal: 8, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 4 },
  docName: { flex: 1, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  work: { flex: 1 },
  web: { flex: 1, backgroundColor: 'transparent' },
  toolbar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    minHeight: 52,
  },
  toolBtn: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
