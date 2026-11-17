# SDD ledger — plan: docs/superpowers/plans/2026-11-18-scan-save-polish-cards.md

Design: `docs/superpowers/specs/2026-11-18-scan-save-polish-cards-design.md`. Worktree
`.claude/worktrees/scan-phase-3`, branch `scan-phase-3`, from origin/main 2b4aa8a. Execution: the
`cd-engineering-tools:parallel-agents-coord` skill (owner's rule). Resume prompt at the end of
this file once the run is stopped for context.

## Partition (2026-11-18)

| Agent | OWNER | Owns (only this agent edits) | Tasks |
| ----- | ----- | ---------------------------- | ----- |
| N | native | `apps/pdf-editor-mobile/modules/pdf-scan/android/**` | N1 to N6 |
| C | core | `packages/scan-core/**` (except `src/types.ts`, lead) | C1 to C4 |
| U | screens | `apps/pdf-editor-mobile/app/**`, `src/scan/**` (except `session-data.ts`), `src/library/**`, the app's `package.json` `test` script | U1 to U4 |
| lead | lead | `modules/pdf-scan/src/index.ts`, `packages/scan-core/src/types.ts`, `src/scan/session-data.ts`, `pnpm-lock.yaml`, `app.json`, docs | Task 0, I1 |

Shared files (two agents edit): none. The streams are disjoint by directory, so no filelock is
used. Within a stream one agent runs its tasks in order.

## Rulings

- Ruling: no filelock and no coord for the three streams — directories are disjoint and each
  stream is one agent — costs nothing if wrong beyond a commit conflict on `pnpm-lock.yaml`, which only the lead edits.
- Ruling: per-task reviewers are replaced by section 5 of the skill (controller checks diff stat and
  named tests; one batched reviewer per wave on risky commits; one whole-branch review at close) —
  cost: a defect surfaces one review later.
- Ruling: `cardMode` is optional (`cardMode?: boolean`) in `ScanCameraViewProps` so the Phase 2 capture screen typechecks until Stream U passes it.
- Ruling: `scan-core` `package.json` `test` script lists its files by name; Stream C replaces the placeholder `types.test.ts` entry with its own list.
- Ruling: the app's tests of the sort `node --test` need no native; Stream N is the only stream that runs Gradle, to avoid two builds in one Gradle home.

## Log

- Task 0: complete (commit 15213cb). session-data tests 9 pass; scan-core test 1 pass; typecheck clean in both.
- Stream U: complete (commits 0d85367, 9694b3e, b12d45a, 03f980d). Controller checked the diff stats (only owned paths) and re-ran: app test 20 pass, typecheck clean after scan-core landed, lint clean (agent's run). Not run on a device.
- Stream C: complete (commits 0c28816, 6b7d199, 20e68dd, eadc93bf). Controller re-ran: scan-core test 29 pass, typecheck clean; agent also ran library-core test 95 pass. C1 and C4 tests were written with the code, not seen failing first (agent's disclosure). A PDF from `writeScanPdf` opened in macOS PDFKit in a one-off scratch run.
- Ruling: `ScanServiceDeps.now?` is an extra optional dep (clock for titles and the PDF date); harmless — cost if wrong: none.
- Ruling: sheet pages keep the composed sheet as `<pageId>.orig.jpg` and process it with filter `original`, so Rotate works on a sheet; the card photos themselves are not kept.
- Deferred minor (C): `saveSession` creates the item row, then the page rows in a second transaction (`createItem` cannot join one). A hard kill in that millisecond gap leaves a scan item with no pages that the start-up sweep does not remove. Fix later with a sweep for scan items without `scan_pages`.
- Deferred decision for Phase 4 (U): "Open in editor" passes `itemId`, so the editor re-indexes the scan item from the PDF text and would overwrite OCR text via `setBody`. Harmless now; decide before Phase 4.
- Stream N: complete (commits 358a191f, 9f4f8e35, 2a504891, dc764eec, 0f8ddb49, c5eb5453, 3257d645). Controller re-ran Gradle `:pdf-scan:testDebugUnitTest :app:assembleDebug`: BUILD SUCCESSFUL, 54 Kotlin tests, 0 failures (most tasks up to date). Filters passed their first run with untuned constants: phone tuning pending.
- Integration (commit ba46955c): version 1.3.0, SPEC and PRD and app CLAUDE.md updated. `pnpm test` exit 0, `pnpm typecheck` exit 0, app lint exit 0. expo-doctor not yet run.
- Batched review (opus, read-only, whole range 5a88c82..ba46955c): approve with comments. Important 1: a title with `#` breaks Share PDF and Open in editor (`encodeURI` keeps `#`, `java.io.File(URI)` rejects a fragment). Minor 2 to 9 listed in the fix brief below. Rollback of a new scan, the PDF writer, and the three-layer contract were checked and found fine.
- Ruling: Minor 8 (card-shaped detection for imported photos) is fixed in the app by re-running `detectQuad(dest, true)` after `importImage` in a card session, not by a contract change.
- Ruling: Minor 9 (unlinked free xref entries) deferred: pdf.js and PDFKit open it.
- Fix wave BASE: ba46955c.
- Fix wave: complete (commits ad456930, aa77f5d2, ad569795, 940acc62, a3282da8; the agent's first run was cut off by a session end after finding 1, then resumed). All eight review findings addressed; controller read the scan-service diff and re-ran: scan-core test 34 pass, app test 20 pass, `pnpm typecheck` exit 0, app lint exit 0. Findings 2, 3, 4 and 1 each have a test that failed before the fix. Findings 5, 7 and the import path of 8 are UI-only and unproven until the phone.
- `expo-doctor`: 16 of 18 pass. Failing: (a) the known app-config sync check, which predates this work; (b) "common project setup issues", saying a local module's android/ios folder is gitignored. All 27 tracked files under `modules/pdf-scan/android` are tracked and not ignored; the likely trigger is the local `android/build/` Gradle output. Not confirmed against a clean main.
- Deferred minors: free xref entries are unlinked when no words exist (opens in PDFKit and pdf.js); item-row-then-page-rows gap on a hard kill; "Open in editor" re-indexes the scan through the editor (decide before Phase 4); a failed `refreshThumb` after `deletePage` leaves the page deleted but the thumbnail stale.
- Not done, needs the owner: Store release (`pnpm release pdf-editor`, owner's go plus Cloudflare account confirmation), phone test of the plan's Task I1 step 5, PR into main.

## Rulings I made (cost if wrong)

1. No filelock or coord for the three streams (directories were disjoint). Wrong: a commit conflict, none occurred.
2. One batched review plus controller checks instead of a reviewer per task. Wrong: a defect surfaces one review later; the one review did find one Important bug.
3. `cardMode` optional on the camera view. Wrong: none.
4. Imported-photo card detection fixed in the app, not by a native contract change. Wrong: a card photo imported into a document-mode session still gets document-shaped detection.
5. Free xref entries left unlinked. Wrong: a strict PDF validator might warn.
6. Gradle and unit tests run once by me at integration, so most tasks were up to date. Wrong: none; test results files showed 54 tests, 0 failures.
