# Clean up the gallery, Phase 2.2 (screens and delete flow) Implementation Plan

> **For agentic workers:** executed with `cd-engineering-tools:parallel-agents-coord` (the owner's rule replaces
> superpowers:subagent-driven-development). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Photos tab gets "Search | Clean up". Clean up lists what is worth removing, a review screen lets the owner tick
photos and send them to Android's trash through Android's own dialog, with Undo, a "Recently removed" list and "Not a mistake".

**Architecture:** React Native renders only. Every decision a screen makes (labels, counts, ticks, totals, slider mapping, dates)
is a pure function in `apps/design-editor-mobile/src/photos/cleanup.ts`, tested with `node --test`. The screens call the
2.1 design-media API (`cleanupGroups`, `trashPhotos`, `restorePhotos`, `recentlyRemoved`, `dismissCleanup`, `undismissCleanup`,
`clearCleanupDismissals`, `photoIndexState().lastScan`). One small Kotlin change closes 2.1's open Minor 4.

**Tech Stack:** Expo SDK 54 / RN 0.81 / expo-router 6, `@apps-hub/ui` (brand `design`), `@apps-hub/media-core` (`formatMb`),
Kotlin (Expo Modules API) + JUnit 4.

**Spec:** `docs/superpowers/specs/2026-11-13-gallery-cleanup-design.md` (Screens, Acceptance; AC-4 as amended 2026-11-18),
`docs/superpowers/plans/2026-11-18-gallery-cleanup-phase-1.md` (R1-R12, the JS contract), `docs/handoffs/image-tools.md`.

## Global Constraints

- RN only renders; no new npm or Gradle dependency. Use `@apps-hub/ui` components (`Screen`, `Header`, `Group`, `Row`, `Button`,
  `Segmented`, `Notice`, `Sheet`, `Empty`, `Pill`, `Text`, `Progress`) and its tokens; never hand-roll colours or fonts.
- Copy: sentence case, active voice, plain words, no engineering terms (the app's `plain-words.test.ts` scans every file),
  no emoji, no ALL CAPS. Errors say what happened and how to fix it. Use the exact copy in "Copy" below.
- AC-1 / AC-6: no code path removes or edits a gallery file except `DesignMedia.trashPhotos(uris)`, and only with the URIs the
  owner ticked on screen. `restorePhotos` only for Undo and "Recently removed". No `fetch`, no file writes from these screens.
- Erasable TypeScript only; import local TS with the `.ts` extension in files node tests load (`cleanup.ts` and its test).
  Types from `design-media` come in with `import type` (erased, so node never loads the native module).
- A new `*.test.ts` runs only once added to `apps/design-editor-mobile/package.json` `test`.
- The Search side of the Photos tab behaves exactly as today.
- Gradle builds run under the `gradle` filelock run key.

## Rulings (decided here; implementers do not revisit)

- P1 Where Clean up lives: the `Segmented` ("Search" | "Clean up", accessibilityLabel "Photos view") shows only in the tab's
  main view (today's `view === 'search'`). Before that (no access, search tool not downloaded, first scan) the tab works as today,
  because the index Clean up reads is built by the same scan, which needs the search tool. Flag to the owner.
- P2 Routes: overview is a component inside `app/(tabs)/photos.tsx`; review is `app/cleanup/[kind].tsx`
  (`router.push('/cleanup/' + kind)`); Recently removed is `app/cleanup/removed.tsx`. Stack screens have no native header
  (root `Stack headerShown: false`), so each has `Header` plus a ghost "Back" button (`router.back()`), like `app/queue/all.tsx`.
- P3 Review shows every group of one kind. Copies and Look-alikes: one section per group (a set), its keeper marked with a
  `Pill` "Best". Blurry, Screenshots, Too dark: one section.
- P4 Overview counts use the engine default strictness. The slider lives only in the Blurry review and is not saved.
- P5 Slider: an app-local `StrictnessSlider` (PanResponder, no dependency), linear between `blur.min` and `blur.max`, starting at
  `blur.default`; groups reload on release only. Higher threshold = more photos shown. `accessibilityRole="adjustable"` with
  increment/decrement actions of 1/10 of the range. Ticks survive a reload for photos still shown (`mergeTicks`).
- P6 Ticks: from the engine (`ticked`); copies and look-alikes pre-ticked except Best, others unticked (owner 2026-11-18).
  "Tick all" ticks every photo except the Best ones; "Untick all" unticks every photo. The owner can still tick a Best by hand;
  when every photo of a set is ticked, a warn Notice says so (no block; Android's dialog still confirms).
- P7 Delete: the footer button calls `trashPhotos(selection.uris)`. While the call is open the button is busy (no second call).
  `moved > 0` → Done Notice with Undo (`restorePhotos(answer.uris)`), then reload groups. `moved === 0` (owner cancelled) →
  nothing shown, ticks unchanged. A rejection → danger Notice with `plainError(e, fallback)`.
- P8 "Not a mistake": in the review, each Copies/Look-alikes section has a ghost "Not a mistake" (dismisses every photo of that
  set in this kind); a long press on any tile opens a `Sheet` with the photo, "Not a mistake" (that photo, this kind) and "Open".
  After a dismiss: a Notice "Hidden from <kind>." with "Undo" (`undismissCleanup(kind, uris)`), then reload. The overview has a
  ghost "Show hidden photos again" (Alert to confirm, then `clearCleanupDismissals()`, then reload).
- P9 Recently removed: rows (no thumbnails: trashed photos' thumbnails are an unproven phone check), each with "Restore",
  plus "Restore all". Always shows the Notice about the Gallery app (HyperOS trash visibility is still unknown).
- P10 Minor 4: when Android's dialog returned OK but the trash record write fails, `trashPhotos` resolves (not rejects) with
  `{ moved, uris, noted: false }`; normally `noted: true`. `restorePhotos` answers are unchanged.

## Copy (exact; every new on-screen sentence)

| Where | Text |
|---|---|
| Segments | `Search`, `Clean up` |
| Kind names | blurry `Blurry`, copies `Copies`, lookalikes `Look-alikes`, screenshots `Screenshots`, dark `Too dark or too bright` |
| Overview row | title kind name; subtitle `214 photos · 1.2 GB`; accessibilityLabel `Blurry · 214 photos · 1.2 GB` |
| Last scan | `Not checked yet` / `Checked just now` (< 1 min) / `Checked 5 minutes ago` (1 minute) / `Checked 3 hours ago` (1 hour) / `Checked 2 days ago` (1 day) |
| Scanning | `Still checking your photos. More may show up when it's done.` |
| Partial access | Notice title `Only the photos you picked are checked`, action `Change` |
| Nothing found | Empty title `Nothing to clean up`, body `No blurry photos, copies or look-alikes right now.` |
| Load failed | Notice danger title `Couldn't load Clean up`, action `Try again` |
| Overview links | Row `Recently removed`; ghost button `Show hidden photos again`; Alert title `Show hidden photos again?`, body `Photos you marked as not a mistake will be suggested again.`, buttons `Cancel` / `Show them` |
| Review | `Tick all`, `Untick all`, `Not a mistake`, `Best`, `Back`; slider label `How blurry`, ends `Very blurry only` / `A little blurry too` |
| Footer | `Delete 37 photos (412 MB)`, `Delete 1 photo (2.1 MB)`, `Delete` (disabled) when none ticked |
| Whole set ticked | Notice warn `Every photo in a set is ticked. Untick one to keep it.` |
| Done | `37 photos moved to trash. You can restore them for 30 days.` / `1 photo moved to trash. You can restore it for 30 days.`; action `Undo` |
| Not noted (P10) | appended: `Clean up couldn't add them to Recently removed. Undo now if you need them back, or look in your Gallery app's trash.` |
| Restored | `37 photos are back in your gallery.` / `1 photo is back in your gallery.` |
| Delete failed (fallback) | `The photos weren't moved. Try again.` |
| Restore failed (fallback) | `The photos weren't restored. Try again.` |
| Hidden | `Hidden from Blurry.` (kind name), action `Undo` |
| Recently removed | Header `Recently removed`; Notice `Your Gallery app may not show photos removed here. To get them back, restore them from this list.`; row subtitle `2.1 MB · 27 days left` / `2.1 MB · Less than a day left`; buttons `Restore`, `Restore all`; Empty title `Nothing removed`, body `Photos you remove in Clean up stay here for 30 days.` |
| Photo sheet | title `Photo`; buttons `Not a mistake`, `Open` |

## Review Focus

1. The owner cancels Android's dialog: nothing changes, no alarming message, ticks stay (Task 4; reviewer traces the `moved === 0` path).
2. Every photo of a copies set ticked by hand: the warn Notice shows before Delete (Task 1 `wholeSetTicked` test).
3. The Blurry slider moved after ticking: ticks kept for photos still shown, new ones take the engine default (Task 1 `mergeTicks` test).
4. After a delete the groups reload: ticks for photos no longer shown never reach `trashPhotos` (Task 1 `selectionIgnoresGoneUris` test).
5. Trash OK but the record write fails: Undo still gets the URIs (Task 2 test `notedFalseStillReturnsUris`).

---

### Task 1: Pure helpers (`src/photos/cleanup.ts`)

**Files:** Create `apps/design-editor-mobile/src/photos/cleanup.ts`, test `apps/design-editor-mobile/src/__tests__/cleanup.test.ts`;
modify `apps/design-editor-mobile/package.json` (append `src/__tests__/cleanup.test.ts` to `test`).

**Interfaces — Produces** (types `CleanupKind`, `CleanupGroup`, `CleanupPhoto`, `RemovedPhoto` via `import type` from `design-media`):
```ts
export type Ticks = Record<string, boolean>;                       // uri -> ticked
export function kindName(kind: CleanupKind): string;
export function sizeText(bytes: number): string;                   // < 1e9: formatMb(bytes) ("412 MB"); else "1.2 GB" (1 decimal, decimal units)
export function photosText(n: number): string;                     // "1 photo", "1,214 photos" (en-US grouping)
export interface KindRow { kind: CleanupKind; title: string; subtitle: string; label: string; count: number; bytes: number }
export function kindRows(groups: CleanupGroup[]): KindRow[];       // one per kind with groups, first-seen order; count = photos not `best`; bytes = sum of group.bytes
export function lastScanText(lastScan: number, now: number): string;
export function initialTicks(groups: CleanupGroup[]): Ticks;
export function mergeTicks(prev: Ticks, groups: CleanupGroup[]): Ticks; // prev value for uris still present, engine default for new
export function tickAll(groups: CleanupGroup[], on: boolean): Ticks;   // on: all but best; off: none
export function selection(groups: CleanupGroup[], ticks: Ticks): { uris: string[]; count: number; bytes: number }; // only uris present in groups, each once
export function deleteLabel(count: number, bytes: number): string;
export function wholeSetTicked(groups: CleanupGroup[], ticks: Ticks): boolean; // a copies/lookalikes group with >= 2 photos all ticked
export function doneText(moved: number, noted: boolean): string;
export function restoredText(n: number): string;
export function removedText(p: RemovedPhoto, now: number): string;
export function hiddenText(kind: CleanupKind): string;
export function blurAt(fraction: number, blur: { min: number; max: number }): number; // fraction clamped to 0..1, linear
export function blurFraction(threshold: number, blur: { min: number; max: number }): number; // inverse, clamped 0..1
```
All text exactly as in "Copy".

- [ ] Step 1: tests (build groups in the test): `kindNamesAndRows` (blurry group of 3 photos, bytes 1_200_000_000 → title `Blurry`,
  subtitle `3 photos · 1.2 GB`, label `Blurry · 3 photos · 1.2 GB`; two copies groups of 2 with one best each → count 2),
  `sizeTextUnits` (412_000_000 → `412 MB`, 2_100_000 → `2.1 MB`, 1_250_000_000 → `1.3 GB`), `photosTextPlural` (1, 2, 1214),
  `lastScanTextSteps` (0 → `Not checked yet`; 30 s → `Checked just now`; 61 s → `Checked 1 minute ago`; 5 min; 1 h → `Checked 1 hour ago`;
  3 h; 26 h → `Checked 1 day ago`; 3 days), `initialTicksFromEngine`, `mergeTicksKeepsOwnerChoices`, `tickAllSkipsBest`,
  `selectionIgnoresGoneUris` (a ticked uri not in groups is not counted), `deleteLabels` (37/412_000_000 → `Delete 37 photos (412 MB)`;
  1/2_100_000 → `Delete 1 photo (2.1 MB)`; 0 → `Delete`), `wholeSetTicked` (best ticked by hand → true; blurry all ticked → false),
  `doneAndRestoredText` (37 and 1, noted true and false), `removedTextDaysLeft` (expiresAt − now = 27.2 days → `2.1 MB · 27 days left`;
  0.5 day → `2.1 MB · Less than a day left`; past → `Less than a day left`), `hiddenTextUsesKindName`, `blurMapping` (0 → min, 1 → max,
  −1 → min, 2 → max, `blurFraction(blurAt(0.39, b), b)` ≈ 0.39).
- [ ] Step 2: run `node --test apps/design-editor-mobile/src/__tests__/cleanup.test.ts`, see it fail.
- [ ] Step 3: implement. Step 4: test passes; `pnpm --filter design-editor-mobile test` and `typecheck` pass.
- [ ] Step 5: commit (pathspec).

### Task 2: Undo URIs survive a failed record write (Kotlin, P10)

**Files:** Modify `apps/design-editor-mobile/modules/design-media/android/src/main/java/expo/modules/designmedia/{core/TrashFlow.kt,android/CleanupTrash.kt}`,
`modules/design-media/src/index.ts` (contract comment and type); tests `core/TrashFlowTest.kt`, `CleanupWiringTest.kt`.

**Interfaces — Produces:** `trashAnswer(action, uris, noted: Boolean = true)`: TRASH → `{moved, uris, noted}`; RESTORE unchanged
`{restored, uris}`. TS: `trashPhotos(uris: string[]): Promise<{ moved: number; uris: string[]; noted: boolean }>`.

- [ ] Step 1: tests: `notedFalseStillReturnsUris` (`trashAnswer(TRASH, a, noted = false)` == `{moved: 2, uris: a, noted: false}`); update the
  existing `trashAnswer` assertions (TRASH now carries `noted: true`); `CleanupWiringTest`: the record-failure path in `CleanupTrash.kt`
  resolves `trashAnswer(..., noted = false)` and `TrashNotNoted` is gone.
- [ ] Step 2: fail. Step 3: implement (`onResult`: record failure → resolve with `noted = false`; delete `TrashNotNoted`).
- [ ] Step 4: `./gradlew :design-media:testDebugUnitTest :app:assembleDebug` (gradle lock) and `pnpm typecheck` pass. Step 5: commit.

### Task 3: Photos tab segment, Clean up overview, Recently removed

**Files:** Modify `apps/design-editor-mobile/app/(tabs)/photos.tsx`; create `apps/design-editor-mobile/src/photos/CleanupOverview.tsx`,
`apps/design-editor-mobile/app/cleanup/removed.tsx`.

**Consumes:** Task 1 (`kindRows`, `lastScanText`, `removedText`, `restoredText`, `photosText`); design-media `cleanupGroups`,
`recentlyRemoved`, `restorePhotos`, `clearCleanupDismissals`, `photoIndexState`.

- [ ] Step 1: `photos.tsx`: segment state `'search' | 'cleanup'` (P1) under the header; Search renders exactly as today; Clean up renders
  `<CleanupOverview lastScan={index.lastScan} scanning={!!job} access={access} onChangeAccess={ask} />` inside `Screen scroll`, below the
  same `Header` (its "Scan now" serves both).
- [ ] Step 2: `CleanupOverview`: loads `cleanupGroups()` on focus (`useFocusEffect`) and when `lastScan` changes; shows the last scan
  line, the scanning line, the partial-access Notice, a `Group` of `Row`s from `kindRows` (`onPress` → `/cleanup/<kind>`), the Empty
  state, the load-failed Notice with Try again, a Row "Recently removed" → `/cleanup/removed`, and "Show hidden photos again" (P8).
  Stale answers dropped (request counter, as `photos.tsx` does).
- [ ] Step 3: `removed.tsx` (P9): `recentlyRemoved()` on focus; rows with `removedText`; Restore / Restore all → `restorePhotos`;
  `restored > 0` → success Notice `restoredText`, reload; 0 → nothing; rejection → danger Notice with the restore fallback.
- [ ] Step 4: `pnpm --filter design-editor-mobile test` (plain words) and `pnpm typecheck` pass; `npx expo export --platform android
  --output-dir <scratch>` from the app bundles. Step 5: commit.

### Task 4: Group review, delete and Undo, Not a mistake

**Files:** Create `apps/design-editor-mobile/app/cleanup/[kind].tsx`, `apps/design-editor-mobile/src/photos/StrictnessSlider.tsx`.

**Consumes:** Task 1 (everything tick-, label- and slider-related, `doneText`, `restoredText`, `hiddenText`, `kindName`); Task 2's `noted`;
design-media `cleanupGroups`, `trashPhotos`, `restorePhotos`, `dismissCleanup`, `undismissCleanup`, `open`.

- [ ] Step 1: `StrictnessSlider({ value, blur, onChange })` per P5 (`onChange(threshold)` fires on release and on each a11y action).
- [ ] Step 2: `[kind].tsx`: loads `cleanupGroups(kind === 'blurry' ? { blurThreshold } : undefined)`, keeps only that kind; ticks
  `initialTicks` then `mergeTicks` on reloads; sections per P3 in a `FlatList` (rows of 3 tiles, tile size as `PhotoGrid`); a tile is a
  checkbox (`accessibilityRole="checkbox"`, `accessibilityState.checked`, label `Photo 3 of 12` plus `, best` when best) showing a tick
  mark when ticked and the "Best" Pill; tap toggles; long press opens the photo Sheet (P8). Header row: Tick all / Untick all;
  `wholeSetTicked` Notice; sticky footer Button `deleteLabel(...)` (danger variant, block, busy while the request is open).
- [ ] Step 3: delete and Undo per P7; Done Notice text `doneText(moved, noted)`, Undo → `restorePhotos(answer.uris)` → `restoredText`
  Notice (0 → nothing). Not a mistake and its Undo per P8. Errors per P7 fallbacks. No path calls `trashPhotos` with anything but
  `selection(groups, ticks).uris` from the current screen state.
- [ ] Step 4: `pnpm --filter design-editor-mobile test`, `pnpm typecheck`, `npx expo export --platform android` pass. Step 5: commit.

## Gates (phase end)

`pnpm test`; `pnpm typecheck`; `cd apps/design-editor-mobile/android && JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew :design-media:testDebugUnitTest :app:assembleDebug`;
`./gradlew :app:dependencies --configuration releaseRuntimeClasspath` has no Play, ML Kit or LiteRT artifacts;
`npx expo export --platform android` (from the app, to a temp dir) bundles; TS gates again from a `git archive HEAD` export with
`pnpm install --frozen-lockfile`. No desktop-app (Electron) tests.

## Not in this phase

Release through the Store, phone checks (HyperOS trash visibility, trashed-URI thumbnails, R1-R4 recheck on phone thumbnails),
saving the slider value, thumbnails in Recently removed.
