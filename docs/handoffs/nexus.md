# Handoff: Nexus (AI knowledge layer for PDF Editor)

## Resume prompt

Dated 2026-11-18. Work in `/Users/outsentia/Documents/apps-hub/.claude/worktrees/nexus` on
branch `nexus`. Read `docs/handoffs/nexus.md` completely first, then
`docs/superpowers/specs/2026-11-18-nexus-design.md` (the design) and `docs/nexus/PRD.md`
(the owner's PRD). Trust the decisions and verified facts below and don't re-derive them.
Follow the handoff contract in `~/.claude/CLAUDE.md`: keep the session log and current
state up to date as milestones land, and near 85% context finalise the state and print a
new resume prompt. Read "Current state + exact next step" and continue from it. Commit,
push or release only when the owner says so.

## Goal and fixed constraints

- The owner's "Project Nexus" PRD: grow PDF Editor (`apps/pdf-editor-mobile`,
  `com.haroon.pdfeditor`, Store id `pdf-editor`) into a personal knowledge app with an AI
  pipeline, a knowledge graph and grounded Ask.
- The owner said "dive in" (2026-11-18) instead of answering design questions, so the
  design's **(call)** items are mine and open to change.
- Android first via the private Store; iOS optional and last. FOSS app code, zero
  telemetry; AI is opt-in with the owner's own key and the app is fully offline without
  one. New app dependencies need the owner's approval.

## Decisions made (with why)

- Extend the Library (`library.db`, expo-sqlite) instead of the PRD's op-sqlite schema:
  Scan and Reader already build on it.
- `library` step 2 rebuilds `items` to widen `kind` (`note`, `audio`, `image`); it keeps
  `rid` (FTS rowid) and restores `item_tags`, which `DROP TABLE` would cascade away.
- Graph lives in a `knowledge` migration track, tables prefixed `kn_`, keyed by
  `items.id` with cascade.
- Brute-force cosine in TS instead of sqlite-vec (node tests can't load the extension);
  marked as a shortcut.
- One OpenAI-compatible adapter over `fetch`; no sync outbox; no background worker in v1.

## Evidence / facts already verified

- Only `item_tags` references `items(id)` on `main` (git grep, 2026-11-18). No other
  branch had pending `packages/library-core` changes (scan-phase-2/3 diffs empty).
- The app opens `library.db` with `PRAGMA foreign_keys = ON` (`open-library.ts:16`), and
  `Library.open` refuses a connection without it.
- Inflow and Deputy have Kotlin OpenAI-compatible clients; the house rule is to copy, never
  import across apps.
- Model Host Phase 0 (2026-11-06): on-device LLMs too slow on the owner's phone.

## File map

- `docs/superpowers/specs/2026-11-18-nexus-design.md`: design and phases N1–N6.
- `docs/nexus/PRD.md`: the owner's PRD.
- `packages/library-core/src/schema.ts`: library step 2.
- `packages/knowledge-core/`: N1 (schema, queue, pipeline, resolution, graph, Ask, OpenAI
  adapter) and its tests.

## Session log

- 2026-11-18 S1: read the repo against the PRD, wrote the design and this handoff,
  created the worktree from `origin/main` 43856547, built N1:
  - `library` step 2 + `ItemKind` widened + app labels/icons for note, voice note, image.
    New test `library-kinds.test.ts` (v1 → v2 keeps folder, tags, FTS, delete trigger).
    library-core 97/97.
  - `packages/knowledge-core`: `Knowledge` (enqueue, retry, recover, runNext, job,
    summary, related, ask), `cleanExtraction`, `chunkSegments`, `openAiPort` (embed,
    extract, answer, readImage, transcribe). 31/31 tests; typecheck clean for
    library-core, knowledge-core and pdf-editor-mobile; pdf-editor-mobile tests 7/7.
  - Code review (code-reviewer agent): migration confirmed safe. Fixed its three confirmed
    bugs, each with a regression test that fails without the fix (checked by reverting):
    `recover()` now bumps `gen`; every stage checks `isLive` (gen) inside its write
    transaction so a stale run writes nothing; `absorb` never takes a norm another concept
    owns as an alias. Nits done: SPEC §4.2 kind list, step 2 comment. knowledge-core 34/34.
  - Open from the review, for N2: `fetch` has no timeout, so a hung request holds a worker
    until `recover()` re-queues it (safe now, just slow). Add an AbortController timeout
    in the app worker, long enough for Whisper on long recordings.

- 2026-11-18 S1 (cont.): owner said yes to OpenAI, expo-secure-store + expo-audio, and the
  rename; "start N2". Built N2 in the same worktree (uncommitted):
  - Deps: expo-secure-store 15.0.8, expo-audio 1.1.1 (MIT, AndroidX only, no install
    scripts). The repo installs with pnpm's isolated linker (app `node_modules`), as main does.
  - Native: RECORD_AUDIO unblocked, background recording on (FOREGROUND_SERVICE_MICROPHONE,
    POST_NOTIFICATIONS), USE_BIOMETRIC/USE_FINGERPRINT blocked (secure-store adds them;
    unused). Name "Nexus" in app.json, strings.xml and `tools/release/src/apps.ts`.
  - App: tabs Stream + Library, `/folder`, `/item` (note editor, voice player with tappable
    transcript, image + text, ideas, related), `/settings` (key check-and-save, process
    existing library). `src/nexus/*`: ai, content, worker, capture, labels, open-citation.
    The editor writes `pages.json` from `docInfo` and enqueues the PDF.
  - knowledge-core: `ideas`, `segmentsOf` (public), `enqueueMissing`, `recover(olderThanMs)`
    (0 on cold start). 37/37.
  - Gates: repo `pnpm test` exit 0, `pnpm typecheck` clean, app lint clean, app tests 10/10,
    `expo export --platform android` bundles, `:app:assembleDebug` BUILD SUCCESSFUL; APK
    label "Nexus", permissions checked with aapt2. expo-doctor: the two failures it reports
    (module gitignore, non-CNG config) are on main too.
  - N2 review (code-reviewer agent), all fixed: the note editor saves and re-queues on close
    (edits inside the 0.8 s / 5 s windows were lost); resume recovers only when none of our
    workers run, and kick/recover take turns (a picker round trip re-queued a long
    transcription and paid twice); recordings are copied and the recorder file deleted only
    after the row exists, and a queue error no longer reads as a failed save; a stale error
    shows only while queued (test added); Play restarts from the end; Ask exchanges keyed by
    id; a failed note save keeps the text; settings footer wording. Re-ran: app typecheck,
    lint, tests 10/10, Android bundle, repo `pnpm test` exit 0.

- 2026-11-18 S1 (cont.): owner: "commit, PR and release". The Store's PDF Editor 1.3.2
  came from the unmerged `scan-phase-3`; the owner chose to merge it into `nexus` and ship
  both as 1.4.0. Conflicts (root layout, test script, open-item) kept both sides. Re-ran:
  repo test + typecheck exit 0, app tests 24/24, lint clean, `:pdf-scan:testDebugUnitTest`
  (59 tests) + `:app:assembleDebug` BUILD SUCCESSFUL, Android bundle OK.

- 2026-11-18 S1 (cont.): also merged `origin/main` (#43 edit/delete menus; conflicts in the
  Library tab, Scan capture and the session test, resolved keeping both). Gates re-run
  green. Pushed `nexus`, opened PR #44. Released `pnpm release pdf-editor`: **Nexus 1.4.0,
  versionCode 18**; manifest re-fetched, all 10 apps intact.

## Current state + exact next step

Nexus 1.4.0 (versionCode 18) is on the Store, built from `nexus` at a88538e8. PR #44 is open
(merge with `[skip ci]` in the subject, owner's go only). Not yet tested on the phone.

Next step: phone test through the coord queue (`device:49kjmnuwonkffqzh`), installing from
the Store only. First check the existing library still opens after the migration (library
step 2 on real data), then: tabs, note capture without a key ("Waiting for an AI key"),
voice note record/stop (and with the screen off), photo, PDF page text; with the owner's key
entered by the owner: transcription, ideas, Ask with citations, seek from a voice
citation, kill-and-resume.

Known shortcuts: cited PDFs open at page 1 (needs a bridge message, N3); recordings over
25 MB fail; first ~24k characters per item feed the graph; brute-force vector search;
no share-sheet ingestion yet; the tab bar rises above the keyboard on the Stream screen.
