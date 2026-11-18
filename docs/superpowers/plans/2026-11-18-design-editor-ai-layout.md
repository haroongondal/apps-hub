# Design Editor: Design with AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (Native) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. The owner's rule: never `superpowers:subagent-driven-development`; use the cd-engineering-tools skills if work is split. Never run the Electron e2e suites.

**Goal:** A "Design with AI" panel on the Mac and the phone that turns a prompt into an editable page built from the editor's own objects.

**Architecture:** A pure module `ai-layout.js` builds the Messages API request and validates the reply. `app.js` turns the validated layout into Fabric objects through `applyTemplate`. Native code only stores the API key and forwards the request (the page's CSP stays closed).

**Tech Stack:** Fabric.js page (plain JS), Electron main (`safeStorage`, `net.fetch`), Expo/RN bridge (`fetch`, `expo-file-system/legacy`), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-18-design-editor-ai-layout-design.md`

## Global Constraints

- CSP in `desktop.html` stays `connect-src 'self' data: blob:`. The page never sees the key.
- Request goes to `https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`; model constant `claude-sonnet-5-5`; 60 s timeout. Check field names against the `claude-api` skill before coding.
- Allowed fonts: `Atkinson Hyperlegible Next`, `Jost`, `Playfair Display`, `Dancing Script`. At most 30 items, text at most 300 characters.
- Sent: prompt, page size, system prompt. Nothing else.
- Copy is sentence case, errors say what happened and how to fix it. Erasable JS only; no new dependency.
- The engine has no build step on the Mac; the phone page is rebuilt with `node packages/design-editor-engine/build.mjs`.

## Review Focus

- Reply with a `text` block only and no tool call: expect "The reply had no layout. Try again." (Task 1 test).
- Colour like `red`, `#fff` or `url(x)`: repaired to a safe default, never passed to Fabric (Task 1 test).
- Prompt that is empty or whitespace: Generate does nothing and says "Describe the design first." (Task 2).
- Key missing or refused (401): clear message, no crash, key field shown (Tasks 2, 3, 4).
- Offline or timeout mid-request: the page is left untouched and Generate is enabled again (Task 2).

---

### Task 1: `ai-layout.js` (pure request and reply handling)

**Files:**
- Create: `packages/design-editor-engine/ai-layout.js`
- Create: `packages/design-editor-engine/test/ai-layout.test.js`
- Modify: `packages/design-editor-engine/package.json` (add `"scripts": { "test": "node --test test/ai-layout.test.js" }`, add `ai-layout.js` to `files`)

**Interfaces:**
- Produces: `AiLayout.buildRequest(prompt: string, W: number, H: number): object` (Messages API body with a forced `make_layout` tool), `AiLayout.parseReply(reply: object): { bg: string, items: Item[] }` (throws `Error` with a plain-words message), `AiLayout.MODEL`, `AiLayout.FONTS`.
- `Item` = `{ type: 'text'|'rect'|'circle'|'star'|'line', x, y, w, h: number (0..1, centre and size as page fractions), text?, size? (0.01..0.3 of the shorter side), font?, bold?, italic?, align?: 'left'|'center'|'right', fill?: '#rrggbb', round? (0..0.5), stroke? (0.002..0.05) }`.
- Exports as `globalThis.AiLayout` and, when `module` exists, `module.exports`.

- [ ] **Step 1: Write the failing tests** in `test/ai-layout.test.js` with `node:test` and `node:assert/strict`:
  - `parses a good tool_use reply`: a reply with one `tool_use` block named `make_layout` and two items returns `bg` and two items unchanged.
  - `repairs bad colours`: `fill: 'red'`, `'#fff'` and `'url(x)'` become `#1d2433`; a bad `bg` becomes `#ffffff`.
  - `replaces unknown fonts with Atkinson Hyperlegible Next`.
  - `clamps numbers`: `x: 4`, `size: 2`, `round: 9` land at 1, 0.3 and 0.5.
  - `cuts to 30 items and 300 characters of text`.
  - `drops unknown item types`.
  - `throws "The reply had no layout. Try again." when there is no tool_use block`.
  - `buildRequest forces the tool and names the page size`: `tool_choice` is `{ type: 'tool', name: 'make_layout' }`, the system prompt contains `1080×1350` for `(1080, 1350)`, the user message is the trimmed prompt.
- [ ] **Step 2: Run** `pnpm --filter @apps-hub/design-editor-engine test`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `ai-layout.js` to the signatures above. One UMD-style IIFE, no DOM. The tool `input_schema` mirrors `Item`; the system prompt says what the allowed fonts and fractions mean and asks for a legible, contrasting layout.
- [ ] **Step 4: Run** the same command. Expected: all pass.
- [ ] **Step 5: Commit** `design-editor-engine: pure AI layout request and reply handling`.

### Task 2: The AI panel in the engine

**Files:**
- Modify: `packages/design-editor-engine/app.js` (new `buildItems`, `generate`, panel wiring; `window.editor` gets `applyLayout`)
- Modify: `packages/design-editor-engine/desktop.html`, `packages/design-editor-engine/mobile.html` (rail button `data-tab="ai"`, `<section data-panel="ai">`, `<script src="ai-layout.js">` before `app.js`)
- Modify: `packages/design-editor-engine/build.mjs` (add `'ai-layout.js'` to `scripts` before `shell-mobile.js`... after it, before `app.js`)

**Interfaces:**
- Consumes: `AiLayout.*` (Task 1); `native.ai.hasKey(): Promise<boolean>`, `native.ai.setKey(key: string): Promise<void>`, `native.ai.request(body: object): Promise<{ ok: boolean, status: number, json?: object, error?: string }>` (Tasks 3 and 4).
- Produces: `buildItems(layout)` returns Fabric objects using `W`, `H`, `s()`, `Textbox`, `Rect`, `Circle`, `Polygon`/`starPoints`, `Line` like the templates; `editor.applyLayout(layout)` calls `applyTemplate({ bg: layout.bg, items: () => buildItems(layout) })`.

- [ ] **Step 1: Panel markup**: prompt `<textarea id="aiPrompt">`, `<button id="aiGo">Generate</button>`, status `<p id="aiStatus" class="hint" role="status">`, a note "Sends your description to Anthropic. Nothing else leaves the device.", and an API key row (`<input type="password" id="aiKey">`, `<button id="aiSave">Save key</button>`) shown when `native.ai.hasKey()` is false, otherwise a "Change key" link.
- [ ] **Step 2: Implement `generate()`**: empty prompt sets the status "Describe the design first." and returns; otherwise disable the button, call `native.ai.request(AiLayout.buildRequest(prompt, W, H))`, map failures to the messages in the spec (no key, 401, 429, timeout/offline, bad reply), on success `editor.applyLayout(AiLayout.parseReply(res.json))` and set status "Done. Undo puts the page back." Always re-enable the button in `finally`.
- [ ] **Step 3: Wire** `aiSave` (calls `native.ai.setKey`, clears the field, hides the row) and the tab (the existing `nav.rail` handler already switches panels by `data-tab`).
- [ ] **Step 4: Verify** with a stub: open `desktop.html` through the Mac app is not allowed in tests, so run `node packages/design-editor-engine/build.mjs` and confirm it exits 0 and `apps/design-editor-mobile/assets/editor/editor.html` contains `data-panel="ai"`.
- [ ] **Step 5: Commit** `design-editor-engine: Design with AI panel`.

### Task 3: Mac native (key and request)

**Files:**
- Modify: `apps/design-editor/preload.cjs` (add `ai: { hasKey, setKey, request }` over `ipcRenderer.invoke('ai-has-key' | 'ai-set-key' | 'ai-request')`)
- Modify: `apps/design-editor/main.js` (three `ipcMain.handle`s; key file `ai-key.bin` under `app.getPath('userData')` encrypted with `safeStorage`)

**Interfaces:**
- Produces: the `native.ai` contract of Task 2. `ai-request` returns `{ ok, status, json }` from `net.fetch(url, { signal: AbortSignal.timeout(60000) })`, or `{ ok: false, status: 0, error: 'offline' | 'timeout' }`; with no key it returns `{ ok: false, status: 0, error: 'nokey' }`.

- [ ] **Step 1: Implement** the handlers. `setKey` refuses when `safeStorage.isEncryptionAvailable()` is false (error `"nosecure"`, the page says "This Mac can't store the key safely.").
- [ ] **Step 2: Verify** `node --check apps/design-editor/main.js apps/design-editor/preload.cjs`. Expected: no output. Do not launch Electron.
- [ ] **Step 3: Commit** `design-editor: Mac handlers for the AI key and request`.

### Task 4: Phone native (bridge)

**Files:**
- Modify: `packages/design-editor-engine/shell-mobile.js` (add `native.ai` over `call('aiHasKey' | 'aiSetKey' | 'aiRequest', ...)`)
- Modify: `apps/design-editor-mobile/src/editor/bridge.ts` (three new `PageEvent` members with `reqId`)
- Modify: `apps/design-editor-mobile/app/editor.tsx` (three `case`s in the message switch; key stored at `FileSystem.documentDirectory + 'ai-key.txt'`; `fetch` with an `AbortController` timeout of 60 s)

**Interfaces:**
- Produces: the same `native.ai` contract and the same `{ ok, status, json?, error? }` replies as Task 3, sent with `replyOk`.

- [ ] **Step 1: Add the bridge types and the three cases.** Key file is written, never returned to the page; `aiHasKey` answers a boolean.
- [ ] **Step 2: Rebuild the page** with `node packages/design-editor-engine/build.mjs`, then run `pnpm --filter design-editor-mobile typecheck`. Expected: exit 0.
- [ ] **Step 3: Update the stub in `shell-mobile.js`'s header comment** ("six original native functions" list) and the SPEC §14.3 line in `docs/design-editor/SPEC.md` so the schema stays in step.
- [ ] **Step 4: Commit** `design-editor-mobile: bridge the AI key and request`.

### Task 5: Docs and the gate

**Files:**
- Modify: `docs/design-editor/PRD.md` (a line in §8 or §4: Design with AI is the one online feature, why, and what is sent)
- Modify: `docs/design-editor/CAPCUT-GAPS.md` line 15 is about media only; leave it.

- [ ] **Step 1: Write the PRD note**, then run `pnpm test` and `pnpm typecheck`. Expected: both exit 0, with the new engine test listed.
- [ ] **Step 2: Device check (owner present).** The phone is shared: follow the coord rules and install through the Store only. Ask the owner before claiming the phone. A real API key is the owner's to enter.
- [ ] **Step 3: Commit** `docs: Design with AI in the Design Editor PRD`.
