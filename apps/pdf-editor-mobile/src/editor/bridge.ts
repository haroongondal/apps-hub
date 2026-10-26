import type { RefObject } from 'react';
import type WebView from 'react-native-webview';

// The frozen bridge schema between the Expo shell and packages/pdf-editor-engine/mobile.html.
// Web -> Native: ready / documentLoaded / pickPdf / pickImage / save
// Native -> Web: open / image / toast (delivered through window.__editorCommand)
export type PageEvent =
  | { type: 'ready' }
  | { type: 'documentLoaded'; ok: boolean; name?: string; pages?: number; error?: string }
  | { type: 'pickPdf'; append: boolean }
  | { type: 'pickImage'; pageIndex: number; x: number; y: number }
  | { type: 'save'; name: string; base64: string };

export type WebCommand =
  | { type: 'open'; name: string; base64: string; append: boolean }
  | { type: 'image'; ok: boolean; base64?: string; pageIndex: number; x: number; y: number }
  | { type: 'toast'; message: string };

// Strict JSON only: the page always posts JSON.stringify-ed payloads.
export function parseMessage(data: string): PageEvent | null {
  try {
    const msg = JSON.parse(data) as { type?: unknown } | null;
    if (msg && typeof msg.type === 'string') return msg as PageEvent;
  } catch {
    // ignore non-JSON chatter
  }
  return null;
}

// Double-encoding is load-bearing: quoting the payload as a JS string literal
// keeps newlines/quotes/backslashes in file names or base64 from breaking the
// injected one-liner.
export function injectCommand(webRef: RefObject<WebView | null>, cmd: WebCommand) {
  const literal = JSON.stringify(JSON.stringify(cmd));
  // The page's frozen signature is __editorCommand(type, payload); the literal
  // decodes to the JSON text, which the page parses back to the object.
  webRef.current?.injectJavaScript(`if (window.__editorCommand) { const c = JSON.parse(${literal}); window.__editorCommand(c.type, c); } true;`);
}
