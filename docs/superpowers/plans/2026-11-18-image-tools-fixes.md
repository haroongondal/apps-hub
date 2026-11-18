# Image tools fixes (owner: "fix all issues", 2026-11-18) Implementation Plan

> **For agentic workers:** Executed with `cd-engineering-tools:parallel-agents-coord` (not superpowers:subagent-driven-development, per the owner's global rule). Steps use checkbox syntax.

**Goal:** Fix the 11 findings from the phone test of build 14 (UI, editor engine, WebView chooser, cut-out maths, upscale rim, download cancel) so build 15 can be released.

**Architecture:** No new features. Small edits in the Clean up screens (`apps/design-editor-mobile/app/cleanup`, `src/photos`), the mobile editor page (`packages/design-editor-engine`), the vision download (`src/photos/vision-tool*.ts`), the WebView chooser (`app/editor.tsx` or a patch) and Kotlin core (`CutoutMaths.kt`, `UpscaleMaths.kt`) with the Python reference in `tools/quick-edits-bench/`.

**Tech Stack:** TypeScript under `node --test`, Kotlin with Gradle JVM tests, plain browser JS in the engine, `@apps-hub/ui` tokens.

**Spec:** `docs/handoffs/image-tools.md` (phone test of 14, Open Minors), `docs/design-editor/SPEC.md` section 14, `docs/superpowers/specs/2026-11-13-{gallery-cleanup,quick-edits}-design.md`; brief `.superpowers/sdd/2026-11-18-image-tools-fixes/phase-brief.md`.

## Global Constraints

- No new Gradle or npm dependency. No Claude attribution in commits. No push, no phone, no install, no release.
- Never run desktop-app tests (no `pnpm --filter design-editor test:e2e`, nothing that opens Electron).
- Copy: sentence case, active voice, plain words; colours and fonts only from `@apps-hub/ui` tokens.
- Node strips types: erasable TypeScript only, imports with `.ts` extension; a new `*.test.ts` must be named in its package's `test` script.
- Kotlin owns image/model work; `design-media` never touches the network (`DataSafetyRulesTest`).
- Commit by pathspec only; never `git add -A`, stash, reset, checkout.

## Review Focus

- Undo/Redo when the selected object no longer exists after the restore (deleted object): selection clears, no throw.
- Undo when the Uploads panel is not the current panel: the panel stays whatever it was.
- Days-left helper at exactly 30 days, 29.999 days, 1 day, 0.5 day, past expiry (negative).
- Cut-out contrast curve on a subject that is genuinely semi-transparent (hair, glass): must stay soft, not become a hard cliff; fully 0 and 1 map to themselves.
- Download cancel after the download already finished, and cancel twice: no throw, no partial file left.

## Tasks (6 implementer tasks; reviews batched)

### Task 1: Clean up screens (items 1, 2, 3, 4)
Files: `apps/design-editor-mobile/app/cleanup/[kind].tsx`, `app/cleanup/removed.tsx`, `src/photos/cleanup.ts`, `src/__tests__/cleanup.test.ts`.
- [ ] Item 1: Best badge solid (`c.accent` background, `c.onAccent` text) with its own legible size, in `renderTile`.
- [ ] Item 2: `removedText` rounds up (a just-removed photo shows "30 days left"; under 1 day "Less than a day left"; exactly 1 day "1 day left"). Test written first.
- [ ] Item 3: a new delete clears the older result line (`message`); a restore replaces `message` and clears `undo` (already). Extract a pure helper in `cleanup.ts` if state logic is non-trivial, test it.
- [ ] Item 4: footer buttons get `accessibilityLabel` "Undo delete" (Done line) and "Undo hide" (Hidden line), visible text stays "Undo"; drop the tile `accessibilityHint="Touch and hold for more"` (keep the custom action).
- [ ] Run `node --test` for cleanup.test.ts, `pnpm --filter design-editor-mobile test`, typecheck. Commit.

### Task 2: Upscale sheet, blank sheet (items 5, 8)
Files: `packages/design-editor-engine/{app.js,mobile.html,shell-mobile.js,touch.js}`, `test/` (new `*.test.mjs` for any pure helper, named in the engine `package.json` test script).
- [ ] Item 5: while a run is going the progress bar and Cancel stay visible (pin them above the scrolling content or scroll into view).
- [ ] Item 8: find why the sheet paints 2-5 s after a tap; fix; report the cause or the measurements and next step.
- [ ] `pnpm --filter @apps-hub/design-editor-engine test`; `node packages/design-editor-engine/build.mjs`. Commit.

### Task 3: Undo keeps selection and panel (item 7) — after Task 2 (same file app.js)
Files: `packages/design-editor-engine/app.js`, new pure helper module + test.
- [ ] Pure helper `reselectAfterRestore(ids, objectId)` style, tested; `undo()`/`redo()` reselect by the engine's object id and do not change the current panel.
- [ ] Engine tests and build.mjs pass. Commit.

### Task 4: Image chooser without camera (item 6)
Files: `apps/design-editor-mobile/app/editor.tsx`, engine file inputs (`mobile.html`, `app.js`: accept/capture), or a minimal config; stop and report if only a new dependency can do it.
- [ ] Remove the camera entry from the chooser; verify by reading the react-native-webview Android source how the chooser intent is built; add a test where possible. Commit.

### Task 5: Cut-out mask and upscale rim (items 9, 10)
Files: `apps/design-editor-mobile/modules/design-media/android/src/main/java/expo/modules/designmedia/core/{CutoutMaths,UpscaleMaths}.kt`, their tests, `tools/quick-edits-bench/ref.py` and fixtures if the maths changes.
- [ ] Item 9: contrast curve before the feather; tests: 0 and 1 fixed, mid alpha pushed, monotonic, subject stays whole on the Phase 0 contact-sheet fixtures; Python reference matches.
- [ ] Item 10: synthetic cut-out through the upscale path; if a rim exists, fix (unpremultiply edge handling) with a red test first; if not, add the test showing none.
- [ ] Gradle under `filelock` key `gradle`. Commit.

### Task 6: Cancel aborts the model download (item 11)
Files: `apps/design-editor-mobile/src/photos/{vision-tool.ts,vision-tool-deps.ts}`, `src/__tests__/vision-tool.test.ts`, the editor's vision host if it owns the cancel.
- [ ] Cancel aborts the in-flight download and deletes the partial file; test with a fake download port: cancel mid-download resolves quickly, partial deleted, cancel twice and after finish are safe. Commit.

## Gates
`pnpm test`; `pnpm typecheck`; Gradle `:design-media:testDebugUnitTest :app:assembleDebug`; `node packages/design-editor-engine/build.mjs`; `npx expo export --platform android` to a temp dir; then the TS gates from `git archive HEAD` with `pnpm install --frozen-lockfile`.
