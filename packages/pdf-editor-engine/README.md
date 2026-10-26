# PDF Editor

A small offline PDF editor for the desktop and phone. Everything runs on the
device you're editing on — nothing leaves your machine.

## Repo map

```
apps-hub/
├── apps/pdf-editor-desktop/   Electron shell: main.js + Playwright tests
├── apps/pdf-editor-mobile/    Expo (SDK 54) app: pick → edit → share
└── packages/pdf-editor-engine/  the shared editor engine (this folder)
    ├── vendor/            unmodified PDF.js 3.11.174 + pdf-lib 1.17.1
    ├── textedit.js        content-stream lexer/rewriter for in-place text edits
    ├── core.js            controller, booted by either shell via pdfEditorShell()
    ├── desktop.html       desktop chrome (native dialogs, download save); styled by packages/ui/web
    ├── mobile.html        mobile chrome (touch strips, toast + confirm sheet)
    └── build.mjs          inlines scripts, shared CSS and fonts into the mobile WebView asset
```

Both shells boot the same `core.js`; they differ only in the adapter they hand
it (`savePdf`, `pickPdf`, `pickImage`, `alert`, `confirm`, `emitDocumentLoaded`,
`supports`). `core.js` classic-scripts PDF.js and pdf-lib — no ES modules — so
the desktop app still works from `file://` with no server and no build step.

## Features

- **Edit existing text in place.** Click a line and retype it. The editor rewrites the PDF's own text, so the result stays real, selectable text. When every character you type is already in the embedded font, the original font is reused; otherwise that line falls back to the closest standard font (Helvetica, Times or Courier, keeping bold and italic).
- **Add content:** text, freehand drawing, highlights, white-out boxes and images, in any colour and size.
- **Pages:** reorder, rotate, delete, and merge in pages from another PDF (Add PDF on desktop, Add on mobile, or drop a file onto the desktop window).
- Undo (Cmd/Ctrl+Z) and delete the selected item (Delete).

## Run the desktop app

From the apps-hub root:

```sh
pnpm install
pnpm --filter pdf-editor-desktop start
```

You can also open `packages/pdf-editor-engine/desktop.html` directly in Chrome, Edge or
Firefox; it works from `file://` with no server.

**Save PDF** writes a new file and never touches the original.

## Run the mobile app (Expo Go)

```sh
pnpm install
pnpm --filter pdf-editor-mobile start
```

Open the URL/QR in [Expo Go](https://expo.dev/go) — no dev client needed. The
mobile `start` script's `prestart` hook runs `packages/pdf-editor-engine/build.mjs`,
which regenerates `apps/pdf-editor-mobile/assets/editor/editor.html` (~2 MB, gitignored
like the test fixtures, never committed).

Pick a PDF on the home screen; the editor runs in a WebView with a native top
bar (back / file name / share). **Save** builds the PDF in the page and hands
it to the system share sheet.

## Test

```sh
pnpm --filter pdf-editor-desktop test:e2e
```

Three checks in `apps/pdf-editor-desktop/test`: an end-to-end drive of the page in Google
Chrome (expected at `/Applications/Google Chrome.app`, so macOS only as
written), a smoke test of the Electron app, and a Chromium device-viewport
drive of `mobile.html` over a fake `ReactNativeWebView` bridge. Device
behaviour (Expo Go, iOS + Android) is a manual checklist: open → replace /
merge, each tool incl. in-place text edit, rotate/move/delete pages,
save→share sheet, dark/light, keyboard readability of the tool bars.

## How text editing works

`textedit.js` lexes the page's content stream and pairs each text-showing
operator (`Tj`, `TJ`, `'`, `"`) with the glyphs PDF.js decodes for it. Runs on
the same baseline are grouped into editable lines. On save, the first operator
of an edited line is replaced with the new text, and the rest are replaced
with empty moves of the same width, so text after them on the page doesn't
shift.

## Limitations

- Edits work one line at a time; paragraphs don't reflow.
- Fonts are usually embedded as subsets, so characters the document never used fall back to a standard font.
- Added and fallback text are Latin-only.
- No form filling, and encrypted PDFs may not save correctly (decrypt them first, for example with `qpdf --decrypt`).
- On mobile, saving goes through the system share sheet, so where the file lands is up to the destination app.
- The Expo bridge moves PDFs through the WebView as base64; very large documents (roughly 40 MB and up) may stall. There is no such cap on desktop.
- PDF.js is pinned to 3.x so the page keeps working from `file://`. Its known font flaw (CVE-2024-4367) is mitigated by loading documents with `isEvalSupported: false`.
- The mobile app also ships as a signed APK through the apps-hub Store (`apps/pdf-editor-mobile/releases/`, `docs/app-store.md`); its prebuilt `android/` and `ios/` folders are committed like the other apps.

## Third-party code

`packages/pdf-editor-engine/vendor/` contains unmodified builds of
[PDF.js](https://github.com/mozilla/pdf.js) 3.11.174 (Apache-2.0) and
[pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1 (MIT), with their license
headers intact.
