# Find a photo, Phase 2 (Photos tab) Implementation Plan

> **Execution:** `cd-engineering-tools:parallel-agents-coord` (owner's choice 2026-11-17), never
> `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Photos tab in Design Editor mobile where the owner allows photo access, gets the search
tool once, sees their gallery get ready, types words and gets matching photos, opens one, and asks
for more like it. Plus the Phase 1 items deferred to this phase. Ends at a build ready for a Store
release; the release and the on-phone checks wait for the owner's go.

**Architecture:** Kotlin adds two small things (the reason a scan is waiting, and "has the gallery
changed since the last scan"). Pure TS in `src/photos/` decides what the tab shows and in what
words; the screen `app/(tabs)/photos.tsx` only renders with `@apps-hub/ui`. The Queue tab learns
how to show a photo scan.

**Tech Stack:** Kotlin + JUnit 4; TypeScript, `node --test`; Expo Router, React Native
`PermissionsAndroid`, `FlatList`, `Image`; `@apps-hub/ui` (brand `design`).

**Spec:** `docs/superpowers/specs/2026-11-13-photo-search-design.md` (Scope 1–5, Details, Phase 2,
Acceptance). Phase 1 facts and deferred items: `docs/handoffs/photo-search.md`.

## Global Constraints

- Copy: sentence case, active voice, plain words, no engineering terms, no emoji, no ALL CAPS; errors say what happened and what to do (AGENTS.md, memory "plain words for users").
- UI only from `@apps-hub/ui` (`Screen`, `Header`, `Field`, `Group`, `Row`, `Button`, `Notice`, `Empty`, `Progress`, `Sheet`, `Text`); colours and spacing from `useTheme()`, never hand-rolled.
- Tabs: Designs | Media | Photos | Queue. No Search/Clean up switch until feature 2 exists.
- Results: what `searchPhotos` returns (≤ 60, floor applied in Kotlin), best first, no score shown; empty → "No close matches".
- Data-safety rules unchanged (no network code in `design-media`, never write a gallery file). The search path never touches the network (AC-5).
- Permissions: ask for `READ_MEDIA_IMAGES` and `READ_MEDIA_VISUAL_USER_SELECTED` together; "Selected photos" access is supported and the tab says only those photos are searchable.
- `startPhotoIndex` is called only while the app is in the foreground (a background call throws `ForegroundServiceStartNotAllowedException`).
- New `*.test.ts` must be added to `apps/design-editor-mobile/package.json`'s `test` script. Erasable TS only, `.ts` import extensions.
- Never adb-install on the phone; install through the Store only, after the owner's go (memory). Commit by pathspec on `photo-search`; no Claude attribution lines.

## Decisions this plan makes

- "Use it in a new design" (spec Scope 5) is deferred: the editor stores pictures inside the shared engine's document and has no bridge command to add one; the editor's own image picker already reaches the gallery. Phase 2 ships Open (the phone's viewer, `DesignMedia.open`) and More like this.
- The tab starts a scan when it opens only if the gallery changed since the last finished scan (MediaStore version + generation), so visits don't pile rows into the Queue tab. A "Scan now" button is always there.
- A scan waiting for heat or battery stays one running queue job (Phase 1); the Photos tab says why it is waiting.

## Review Focus

1. Access denied for good ("Don't ask again"): the button must lead to the app's settings page, not do nothing (Task 2 test on the access mapping; Task 3 wiring).
2. The tab opened while a scan from before is running or interrupted: no second scan row (Phase 1 `planIndexStart` + Task 1 cancel of stale rows).
3. Typing fast: only the last query's results show (Task 3: ignore results of an outdated query).
4. A photo deleted after it was indexed: the grid shows a blank tile without crashing; Open says it can't be opened (Task 3; `DesignMedia.open` rejects → plain message).
5. Getting the search tool interrupted or out of space: plain message, button to try again, no half file used (Phase 1 + Task 2 copy test).

---

### Task 1: Kotlin — why a scan waits, gallery changed, stale rows, wake only when needed

**Files:** `.../core/PhotoIndex.kt`, `.../core/Plans.kt`, `.../android/PhotoIndexRunner.kt`, `.../android/PhotoSearch.kt`, `.../android/Gallery.kt`, `.../android/ClipSessions.kt` (line 13 comment only), `.../DesignMediaModule.kt`, `modules/design-media/src/index.ts`; tests `.../core/PhotoIndexTest.kt`. (`...` = `apps/design-editor-mobile/modules/design-media/android/src/{main,test}/java/expo/modules/designmedia`.)

**Interfaces:**
- `fun pauseReason(batteryPct: Int, charging: Boolean, thermalStatus: Int): String?` → `"heat"` when thermal ≥ 3 (checked first), `"battery"` when < 20% and not charging, else null; `shouldPause` becomes `pauseReason(...) != null`.
- `PhotoIndexRunner.waitingFor: String?` (`@Volatile`), set while backing off, null otherwise.
- `fun needsScan(saved: String?, current: String): Boolean` — true when nothing saved or different. `Gallery.stamp(ctx): String` = `"${MediaStore.getVersion(ctx)}:${MediaStore.getGeneration(ctx, MediaStore.VOLUME_EXTERNAL_PRIMARY)}"`; the runner writes the stamp taken **before** listing to `filesDir/photo-index.stamp` only after a scan finishes without cancel or failure.
- `planIndexStart` also returns `stale: List<String>` = ids of INTERRUPTED or PAUSED photo-index rows when it adds a new job; `PhotoSearch.startIndex` sends `MediaJobService.cancel(ctx, id)` for each, and sends the wake-up enqueue only when `!MediaJobService.alive || start.job != null`.
- Module/TS: `photoIndexState(): Promise<{ indexed: number; modelsReady: boolean; waiting: 'heat' | 'battery' | null }>`; new `photoGalleryChanged(): Promise<boolean>` (`needsScan(saved stamp, Gallery.stamp)`).
- [ ] **Step 1: Failing tests** (stubs first so it compiles): `pauseReasonHeatWinsOverBattery` ((10,false,3)→heat; (10,false,0)→battery; (10,true,2)→null; (80,false,4)→heat), `needsScanWhenNothingSavedOrChanged` (null→true; same→false; different→true), `aNewScanStopsTheStaleOnes` (shown queue with one INTERRUPTED and one PAUSED photo row and a DONE one → job added, stale = those two ids; with a QUEUED photo row → no job, stale empty). Run → FAIL.
- [ ] **Step 2:** Implement; run `./gradlew :design-media:testDebugUnitTest :app:assembleDebug` → BUILD SUCCESSFUL, all pass.

### Task 2: TS — what the tab shows, its words, access, and the Queue row

**Files:** create `apps/design-editor-mobile/src/photos/view.ts`, `src/photos/access.ts`; tests `src/__tests__/photos-view.test.ts`, `src/__tests__/photos-access.test.ts`; modify `src/media/status.ts`, `src/media/JobRow.tsx`, `src/photos/search-tool.ts`, `src/__tests__/search-tool.test.ts`, `package.json` (test script line).

**Interfaces:**
- `access.ts`: `type Access = 'all' | 'some' | 'none' | 'blocked'`; pure `accessFrom(r: Record<string, 'granted' | 'denied' | 'never_ask_again'>): Access` (images granted → all; only visual-user-selected granted → some; any `never_ask_again` and nothing granted → blocked; else none); `askForPhotos(): Promise<Access>` (`PermissionsAndroid.requestMultiple` with both permissions, using the string `'android.permission.READ_MEDIA_VISUAL_USER_SELECTED'` if RN has no constant); `checkPhotos(): Promise<Access>` (`PermissionsAndroid.check` both; returns all/some/none, never blocked).
- `view.ts`: `type PhotosView = 'ask' | 'blocked' | 'get-tool' | 'getting-tool' | 'preparing' | 'search'`; `photosView(s: { access: Access; modelsReady: boolean; gettingTool: boolean; indexed: number; scanning: boolean }): PhotosView` — none→ask, blocked→blocked, !modelsReady→ gettingTool ? getting-tool : get-tool, indexed 0 && scanning → preparing, else search.
  `toolResultText(r: SearchToolResult): string | null` — ready → null; `'no-room'` → "Not enough space. Free up about 300 MB and try again."; `'bad-download'` → "The search tool didn't download correctly. Try again."; `'offline'` → "The download stopped. Check your connection and try again.".
  `waitingText(w: 'heat' | 'battery' | null): string | null` — heat → "Paused while your phone cools down. It carries on by itself."; battery → "Paused to save battery. It carries on when you charge or the battery is above 20%.".
  `scanLine(indexed: number, progress: number | null): string` — e.g. "1,204 photos ready to search" / "Getting your photos ready · 37%".
- `status.ts`: for `tool === 'photo-index'`: done → line `"${what} · Ready"` (never "Saved"); everything else as today. `JobRow.tsx`: for photo-index no Share/Open; Try again calls `DesignMedia.startPhotoIndex()`.
- `search-tool.ts`: a rejected `deps.remove` must not reject `getSearchTool` (still returns `'offline'`).
- [ ] **Step 1: Failing tests:** `photos-view.test.ts` (each `photosView` branch; each text function returns the exact strings above; `scanLine(1204, null)` → "1,204 photos ready to search", `scanLine(0, 0.37)` → "Getting your photos ready · 37%"), `photos-access.test.ts` (all four `accessFrom` outcomes), a `status` case for a done photo-index job (no "Saved"), `search-tool` `removeFailureStillReportsOffline`. Run `pnpm --filter design-editor-mobile test` → FAIL.
- [ ] **Step 2:** Implement; run tests → PASS; `pnpm --filter design-editor-mobile typecheck` → clean.

### Task 3: The Photos tab

**Files:** create `apps/design-editor-mobile/app/(tabs)/photos.tsx`, `src/photos/PhotoGrid.tsx`; modify `app/(tabs)/_layout.tsx`.

**Interfaces:** consumes Task 1's module calls and Task 2's helpers; `useQueue()` for the running photo-index job (`tool === 'photo-index'`), `getSearchTool` wired through `search-tool-deps.ts`.
- Tab order Designs | Media | Photos | Queue, label "Photos".
- On focus (`useFocusEffect`): `checkPhotos()`, `photoIndexState()`; if access is all/some and models ready and `photoGalleryChanged()` → `startPhotoIndex()`. Poll `photoIndexState()` every 2 s only while a photo-index job is running. On blur: `releasePhotoSearch()`.
- Views (from `photosView`): **ask** — `Empty` "Find photos by describing them" / "Type a few words, like dog on the beach, and see matching photos. Everything stays on your phone." + Button "Allow access to photos" → `askForPhotos`. **blocked** — same text + Button "Open settings" (`Linking.openSettings()`). **get-tool** — `Notice` "Get the search tool once" "It's 216 MB and works offline after that. Use Wi-Fi if you can." + Button "Get the search tool"; error from `toolResultText` shown in a danger `Notice`. **getting-tool** — `Progress` with the fraction + "Getting the search tool". **preparing** — `scanLine` + `Progress`, plus `waitingText` notice. **search** — `Field` (placeholder "Describe a photo", search on submit and 400 ms after typing stops; ignore results of an outdated query), `scanLine` under it while scanning, `waitingText` notice, Button "Scan now" (ghost) → `startPhotoIndex()`; when access is `some`: `Notice` "Only the photos you picked can be found" + Button "Change" → `askForPhotos`. Results: `PhotoGrid` (FlatList, 3 columns, square tiles, `Image` with `resizeMethod="resize"`, accessible label "Photo n of m"); empty results after a search → `Empty` "No close matches" "Try other words.".
- Tap a tile → `Sheet` titled "Photo" with a large preview, Button "Open" (`DesignMedia.open(uri)`; on reject Alert "This photo can't be opened" "It may have been deleted.") and Button "More like this" (`similarPhotos(uri)` replaces the grid; the field shows "More like this" as a label with a Clear button returning to the last query).
- [ ] **Step 1:** Build it; run `pnpm --filter design-editor-mobile typecheck` → clean; `pnpm --filter design-editor-mobile test` → pass.
- [ ] **Step 2:** `./gradlew :app:assembleDebug` → BUILD SUCCESSFUL; `pnpm --filter design-editor-mobile doctor` → no new problems.

### Task 4: Gates, then stop for the owner

- [ ] **Step 1:** From a clean export of HEAD: `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, `./gradlew :design-media:testDebugUnitTest :app:assembleDebug` → all pass.
- [ ] **Step 2:** Update the handoff; ask the owner for the go to merge and release Design Editor through the Store (memory "release by local command": merge with `[skip ci]`, then `pnpm release` locally), and for permission to copy test photos to the phone for AC-2 (they would go in their gallery and be removed afterwards).

### Task 5 (after the owner's go): on the phone

- [ ] Install from the Store; claim `device:49kjmnuwonkffqzh` with coord. Walk the tab: ask → allow → get the search tool → scan → search. Check AC-1 (airplane mode search), AC-3 (time for 1,000 photos, plugged in), AC-4 (≤ 1 s per search), AC-5 (logcat shows no network in search; gallery files unchanged), AC-6 (scan shows the waiting notice when hot or below 20%), and AC-2 on the COCO set if the owner allowed it. Record numbers in the handoff; release the device.
