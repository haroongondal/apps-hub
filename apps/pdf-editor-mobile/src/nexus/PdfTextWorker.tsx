import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';

import { injectCommand, parseMessage } from '../editor/bridge';
import { openLibrary } from '../library/open-library';
import { itemFile } from '../library/paths';

import { indexPdfItem } from './index-pdf';
import { nextUnindexedPdf } from './pdf-pick';
import { onQueueChange, openKnowledge } from './worker';

const PER_PDF_MS = 60_000;

/**
 * A PDF's text is read by the editor page, so a PDF added by sharing has none until someone opens it. This keeps one
 * invisible copy of that page and feeds it the PDFs nobody has opened, one at a time, while the app is in front.
 */
export function PdfTextWorker() {
  const [assetUri, setAssetUri] = useState<string | null>(null);
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const busy = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const tried = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    Asset.fromModule(require('../../assets/editor/editor.html') as number)
      .downloadAsync()
      .then((asset) => alive && setAssetUri(asset.localUri ?? asset.uri))
      .catch((err) => console.warn('The PDF text reader could not load', err));
    return () => {
      alive = false;
    };
  }, []);

  const finish = useCallback(() => {
    if (busy.current) clearTimeout(busy.current.timer);
    busy.current = null;
  }, []);

  const next = useCallback(async () => {
    if (busy.current || !ready.current) return;
    try {
      const lib = await openLibrary();
      const excluded = await (await openKnowledge()).excludedIds();
      const items = await lib.list({ everywhere: true, kind: 'pdf', ownOnly: true, limit: 500 });
      const item = nextUnindexedPdf(items, { hasPages: (id) => itemFile(id, 'pages.json').exists, excluded, tried: tried.current });
      if (!item || busy.current) return;
      tried.current.add(item.id);
      const timer = setTimeout(() => {
        busy.current = null;
        void next();
      }, PER_PDF_MS);
      busy.current = { id: item.id, timer };
      const base64 = await FileSystem.readAsStringAsync(itemFile(item.id, 'document.pdf').uri, { encoding: FileSystem.EncodingType.Base64 });
      injectCommand(web, { type: 'open', name: `${item.title}.pdf`, base64, append: false });
    } catch (err) {
      finish();
      console.warn('The PDF text reader could not start a PDF', err);
    }
  }, [finish]);

  useEffect(() => {
    const again = () => void next();
    const off = onQueueChange(again);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && again());
    return () => {
      off();
      sub.remove();
    };
  }, [next]);

  const onMessage = useCallback(
    (ev: WebViewMessageEvent) => {
      const msg = parseMessage(ev.nativeEvent.data);
      if (!msg) return;
      if (msg.type === 'ready') {
        ready.current = true;
        void next();
      } else if (msg.type === 'documentLoaded' && !msg.ok) {
        finish();
        void next();
      } else if (msg.type === 'docInfo' && busy.current) {
        const { id } = busy.current;
        finish();
        void indexPdfItem(id, msg).then(() => next());
      }
    },
    [finish, next],
  );

  if (!assetUri) return null;
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, left: 0, width: 360, height: 640, opacity: 0 }}>
      <WebView ref={web} source={{ uri: assetUri }} onMessage={onMessage} originWhitelist={['*']} allowFileAccess textZoom={100} style={{ width: 360, height: 640 }} />
    </View>
  );
}
