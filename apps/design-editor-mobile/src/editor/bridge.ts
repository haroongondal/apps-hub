import type { RefObject } from 'react';
import type WebView from 'react-native-webview';

// The frozen bridge schema between the Expo shell and packages/design-editor-engine by way of
// shell-mobile.js (SPEC §14.3). App.js posts JSON strings; this app answers every reqId with a
// reply, drives menus through injectCommand, and shows dialogs the bridged window.confirm asks
// for. Additions over the six original native functions, as built 2026-11-03:
// - confirm: the page's discardOk() awaits window.confirm, which is sync on the desktop and
//   has to become a bridged promise here.
// - keepAutosave: app.js calls it when a broken autosave cannot be restored; the desktop
//   answers in preload.cjs, so the mobile schema gains it too.
// Web -> Native
export type PageEvent =
  | { type: 'ready' }
  | {
      type: 'saveFile';
      reqId: string;
      name: string;
      ext: 'json' | 'png' | 'jpg' | 'svg' | 'pdf';
      // binary exports cross as base64, json and svg as text (see shell-mobile.js)
      base64?: string;
      text?: string;
      filePath?: string | null;
    }
  | { type: 'openDesign'; reqId: string }
  | { type: 'readAutosave'; reqId: string }
  | { type: 'writeAutosave'; reqId: string; text: string }
  | { type: 'keepAutosave'; reqId: string }
  | { type: 'docState'; title: string; dirty: boolean; filePath: string | null }
  | { type: 'confirm'; reqId: string; message: string };
// Native -> Web
export type WebCommand =
  | { type: 'reply'; reqId: string; ok: boolean; value?: unknown; error?: string }
  | { type: 'menu'; cmd: string } // same ids as the Mac menu (new, save, saveAs, export, undo, redo, duplicate, zoomIn, zoomOut, zoomFit)
  | { type: 'toast'; message: string };

// The autosave record app.js stores through native.writeAutosave and restores from
// native.readAutosave; doc is the design's snapshot text.
export type AutosaveRecord = { filePath: string | null; dirty: boolean; doc: string };

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

// Double-encoding is load-bearing (same as PDF Editor): quoting the payload as a JS string
// literal keeps newlines, quotes and backslashes in names or base64 from breaking the injected
// one-liner. The page's frozen signature is __editorCommand(type, payload).
export function injectCommand(webRef: RefObject<WebView | null>, cmd: WebCommand) {
  const literal = JSON.stringify(JSON.stringify(cmd));
  webRef.current?.injectJavaScript(`if (window.__editorCommand) { const c = JSON.parse(${literal}); window.__editorCommand(c.type, c); } true;`);
}

export const replyOk = (reqId: string, value: unknown) => ({ type: 'reply', reqId, ok: true, value }) as WebCommand;
export const replyError = (reqId: string, error: string) => ({ type: 'reply', reqId, ok: false, error }) as WebCommand;
