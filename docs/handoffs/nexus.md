# Handoff: Nexus (AI knowledge layer for PDF Editor)

## Resume prompt

Dated 2026-11-24. Work in `/Users/outsentia/Documents/apps-hub-wt/eco-nexus` on
branch `eco/nexus`. Read `docs/handoffs/nexus.md` completely first, then
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
- `packages/knowledge-core/`: N1 (schema, queue, pipeline, resolution, graph, Ask, OpenAI-compatible
  adapter) and its tests.

## Session log

- 2026-11-18 S1: read the repo against the PRD, wrote the design and this handoff,
  created the worktree from `origin/main` 43856547, built N1:
  - `library` step 2 + `ItemKind` widened + app labels/icons for note, voice note, image.
    New test `library-kinds.test.ts` (v1 → v2 keeps folder, tags, FTS, delete trigger).
    library-core 97/97.
  - `packages/knowledge-core`: `Knowledge` (enqueue, retry, recover, runNext, job,
    summary, related, ask), `cleanExtraction`, `chunkSegments`, `openAiPort` (now `openAiCompatPort`; embed,
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

- 2026-11-18 S1 (cont.): owner said yes to OpenAI (changed 2026-11-19, #54: Gemini and Groq
  instead, see Current state), expo-secure-store + expo-audio, and the
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

- 2026-11-20 S2: owner asked for a way to keep documents out of the knowledge base (personal
  info, ideas). Built:
  - `knowledge` migration step 3: `kn_excluded(item_id, excluded_at)`.
  - `Knowledge.exclude(id)` deletes the item's jobs, chunks, source node, atoms and its own
    edges, then prunes concepts that lost their last link. Segments stay: they are the item's
    own transcript/OCR and feed Library search. `include(id)` removes the exclusion and
    re-queues from the text stage. `enqueue` and `enqueueMissing` skip excluded items. An
    in-flight stage finds no job and writes nothing (existing `isLive` guard).
  - App: Library item menu gets "Keep out of Nexus" (confirmed, styled destructive) and "Add
    to Nexus"; Stream cards and the item screen show "Not in Nexus". `openKnowledge()` failing
    leaves the Library working with no exclusions.
  - Gates: knowledge-core tests and typecheck clean (new `exclude.test.ts`, 4 tests, registered
    in package.json); pdf-editor-mobile 26/26 tests, typecheck and `pnpm lint` clean.
  - Known limit: a concept's alias names contributed only by an excluded item can persist on
    a concept other items still support (aliases are not tracked per source).
  - Not done: exclude-at-import option; phone test.

- 2026-11-23 S3: CV maker, branch `nexus-cv` (PR #64, merged to main as 6981cf70), rebuilt on `origin/main` after the first
  version conflicted with main's own key handling (#57), which was kept:
  - CV tab (`app/(tabs)/cv.tsx`, `app/cv/new.tsx`, `app/cv/[id].tsx`). Logic in `src/cv/`
    (model, three templates, PDF writer, prompts; pure, tested). The AI writes only the content;
    the user picks Classic, Modern or Minimal. An AI edit returns the whole CV, which is
    validated before it replaces the old one. Export is a PDF in the share sheet.
  - `CompatPort.complete(system, user, json)`; `nexusPort` chat (`extract`, `answer`,
    `complete`) tries Groq's keys, then Gemini's. Embeddings and images stay Gemini only,
    transcription Groq only. In the app's `ai.ts`, text requests time out after 90 s and uploads
    keep 10 min, so a hung service hands over sooner.
  - Shortcuts: base-14 fonts, so no Arabic or Urdu (shown as "?"); estimated text widths, so
    lines wrap a little early; an AI edit that returns a truncated CV replaces the old one.
  - Not done: phone test (adb went offline mid-session); AI calls with real keys.

- 2026-11-23 S4 (eco wave F6, branch `eco/nexus`): the three known shortcuts, each committed when green:
  - Tab bar (6134b70e): the tabs layout hides the custom `TabBar` while the keyboard is shown (a custom
    `tabBar` skips the navigator's `tabBarHideOnKeyboard`). The manifest and app.json already say
    `adjustResize` / `softwareKeyboardLayoutMode: resize`, so neither changed.
  - Cited PDF page (aeae7091): new bridge command `{ type: 'goto-page', page }` in `src/editor/bridge.ts`
    and `core.js`. `openCitation` passes the page to `openItem`, the editor gets a `page` param, holds it
    (`pendingPage` in `src/editor/goto-page.ts`) until the first `documentLoaded`, clamps it to the page
    count and sends it once; the engine clamps again and scrolls a frame later, after the width fit.
    App test `goto-page.test.ts` (7, including a check that core.js handles every command in bridge.ts).
  - Long recordings (5624026f): knowledge-core `audio-chunks.ts`: `planChunks(durationMs, bytes, limit)`
    (pieces under 90% of the limit, 2 s overlap each side, keep ranges that touch), `stitchTranscripts`
    (times moved onto the whole recording; a segment belongs to the piece holding its midpoint; a
    same-text repeat across the cut is dropped) and `transcribeInChunks` (sequential, 3 tries for
    `server`/`bad_reply`, pausing errors keep their kind, any failed piece fails the item, every piece
    file freed). 14 tests. New Android-only module `modules/audio-chunks` (`durationMs`, `cut`) cuts the
    M4A with MediaExtractor + MediaMuxer without re-encoding (no ffmpeg in the app; the recorder writes
    AAC in MPEG-4, so a container copy works); JVM test `CutWindowTest` (5). On iOS the module is absent
    and a long recording fails with a plain message as before. Minutes (M1) can reuse all of it.
  - Gates: app tests 47/47, typecheck and lint clean; knowledge-core 67/67, typecheck clean; engine 2/2;
    `:audio-chunks:testDebugUnitTest :app:assembleDebug` BUILD SUCCESSFUL.
  - Not run (no phone in this wave): Ask citation to a PDF page; a recording over 25 MB; keyboard on Stream.

- 2026-11-24 S5 (eco wave 2, branch `eco/nexus`): Meeting mode, Minutes, searchable minutes, share targets, OCR check,
  each committed when green:
  - M1 long recordings (876bc472, 5fbea4c8): each transcribed piece is saved in `library/<id>/transcribe/piece-<n>.json`
    (`{identity, segments}`; identity = file key + offset + piece geometry), so a retry sends only missing pieces;
    `planSource` plans one or several files on the whole recording's clock; `ContentPort.saved` deletes the pieces
    after the transcript is stored. Gates: app 47/47, knowledge-core 81/81, library-core 106/106.
  - M1 Meeting mode (f0c47c52): `MeetingService` (foreground, type microphone) records AAC in ADTS to
    `documents/meeting/recording.aac`, so a kill keeps what was written; Stop copies it into `audio.m4a` with `cut()`;
    an unsaved meeting is offered on Stream. No wake lock, no restart after a kill, calls are detected as "silenced"
    on Android 10+. Gates: app 54/54, `:audio-chunks:testDebugUnitTest :app:assembleDebug` BUILD SUCCESSFUL
    (MeetingClockTest 3/3).
  - M2 Minutes (6678cdec, c2f3b361): `composeMinutes` (knowledge-core `minutes.ts`), Groq gpt-oss-120b through
    `nexusPort.complete` with the Gemini chat fallback, only on "Make minutes". Transcript fenced as untrusted data,
    every decision and action cited to a segment (uncited ones dropped), hand validator, 3 tries, 10,000-character
    map-reduce windows. Stored in `kn_minutes` (knowledge step 4). Gates: app 57/57, knowledge-core 99/99.
  - M5 searchable (79bb4920, dbeb57f1): `Knowledge.indexBody` puts the minutes lines in the Library body; making
    minutes re-queues the item at `embed` with `kn_jobs.embed_only = 1` (knowledge step 5), so Ask cites decisions at
    their time without re-making the graph. Also removed a duplicate "Scan text" add-sheet entry. Gates: app 57/57,
    knowledge-core 107/107, library-core 106/106.
  - C8 OCR check (521350d8): licence audit below. Offline OCR text reaches nothing in Nexus; English only.
  - E3/M4 share targets (8f335668): `ShareActivity` in `modules/audio-chunks` takes SEND / SEND_MULTIPLE for PDF, text,
    image and audio, copies to `files/shared-inbox/<id>/`, and `app/share.tsx` asks "Add to Nexus?"; nothing is added
    before Add. Audio is kept as `audio.<ext>` in its real format; AMR, 3GP, raw AAC and non-M4A over 25 MB are
    refused. Links and text become notes, never fetched. Gates: app 76/76, Gradle BUILD SUCCESSFUL (ShareRulesTest 8/8).
  - Security fix (0a1b24bd): the share intake could be pointed at Nexus's own FileProvider with an authority like
    `0@com.haroon.pdfeditor.pdfscan.fileprovider` (ContentResolver strips the user id, the old
    `resolveContentProvider` check did not). Now `ShareRules.sourceAllowed`: content:// only, no `@` or `:` in the
    authority, no own authority (all of Nexus's providers from `getPackageInfo(GET_PROVIDERS)`), and the opened
    descriptor's real path (`/proc/self/fd`) outside the app's dirs. `PdfScanFileProvider` now serves only
    `cache/pdfscan-share/`, where `ShareImages` copies the pages it shares. The share screen shows a copy that is
    gone as unreadable.
  - Voice-note fix (9970a3fb): `toggleRecording` sets `shouldPlayInBackground` while recording; expo-audio 1.1.1 on
    Android pauses every recorder on host pause (Home, app switch, screen off) without it. Before this, voice notes
    silently skipped the screen-off span.
  - Final gates (after the last code change): app 77/77, typecheck and lint exit 0; knowledge-core 107/107, typecheck
    exit 0; `:audio-chunks:testDebugUnitTest :pdf-scan:testDebugUnitTest :app:assembleDebug` BUILD SUCCESSFUL
    (ShareRulesTest 14/14, CutWindowTest 5/5, MeetingClockTest 3/3, pdf-scan 59/59); merged manifest checked with
    aapt2: ShareActivity exported with exactly the two filters, PdfScanFileProvider paths only `pdfscan-share/`.
  - Security review (read-only security-engineer, after 81414c56): 0 high, 1 medium, 1 low, 3 suspicions; clean on share
    source checks, inbox, deep link, prompt injection, keys, Meeting service, manifest. Fixed:
    - Keep out mid-transcription (58128c58, medium): `transcribeInChunks` took no stop between pieces, so "Keep out of
      Nexus" while a long recording was transcribing still cut and sent the remaining pieces to Groq and left
      `transcribe/piece-<n>.json`. Now `ContentPort.segments(item, check)` passes the job's live check into
      `ChunkedTranscription.check`, called before each cut and each upload attempt (its error passes through
      unwrapped); a stage stopped because the item was kept out, or that ends after it, calls the new
      `ContentPort.withdrawn(itemId)`, and `exclude()` calls it too, which clears the piece folder. A run re-queued by
      `recover()` also stops at the next piece but keeps the pieces for the newer run.
    - Minutes notice (4de148c9, low): the notice, the replace prompt and the button hint now say Groq, or Gemini when
      Groq cannot answer (the chat fallback stays, the owner's design), and that the minutes go to Gemini to make them
      searchable when a Gemini key is set.
    - Share screen (4e32b1b4): expo-router 6.0.24 hands a deep link to the current route as a NAVIGATE that React
      Navigation 7.6.5's StackRouter applies to the current `share` route (same key, new params), so the screen is
      reused with a new `inbox` while the old payload is still in state. The payload is now kept with its inbox id
      (`payloadFor`), reset when the id changes, and Add uses only the current id's payload.
    - Scan image sharing (4df3e107): copies are numbered (`1-name.jpg`), so two pages with the same file name are both
      shared. No JVM test (one-line rename inside Android-only code).
    - Not a fix, reported: Nexus lists itself in the chooser for "Share images" from Scan; picking it is refused with
      "Nexus only takes files that another app shares with it." and nothing is copied. Confusing, not harmful.
    - Gates after these fixes: app 78/78, typecheck and lint exit 0; knowledge-core 110/110, typecheck exit 0;
      `:audio-chunks:testDebugUnitTest :pdf-scan:testDebugUnitTest :app:assembleDebug` BUILD SUCCESSFUL (audio-chunks
      22/22, pdf-scan 59/59). The code-review pass (chunk persistence, Meeting, Minutes quality) was not run: the
      wave's dispatch cap was reached.
  - Call audio: Nexus can't record phone calls; Android blocks that for apps like Nexus. If another app saved a call
    recording, share it to Nexus.
  - Open owner decision: Arabic/Urdu OCR. tessdata_fast `ara.traineddata` 1,432,056 bytes and `urd.traineddata`
    1,398,718 bytes (about 2.8 MB together), or `script/Arabic.traineddata` 9,311,038 bytes; Design Editor shares the
    module, so its APK grows too. Nothing downloaded.
  - Not run (phone; main session's coord queue, install from the Store only):
    1. Record or import audio over 25 MB with a key set; interrupt after the first piece (airplane mode). Network back
       or kill and reopen: it resumes without uploading piece 1 again (Groq usage count), times run through the whole
       recording, and the item's `transcribe` folder is gone afterwards.
    2. Stream, the people icon next to the mic, Meeting, Start recording; allow microphone and notifications: a
       "Recording a meeting" notice with a running timer and the big elapsed readout.
    3. Screen off 10 minutes, unlock, open Nexus: readout about 10:00. Stop and save: a "Meeting, <date time>" card that
       plays the full length; seek works.
    4. Kill test: start, record 3 minutes, `adb shell am force-stop com.haroon.pdfeditor`. Reopen: "Save the meeting you
       were recording?". Save: the item plays about 3 minutes. If Save fails with "could not be cut", the truncated-ADTS
       assumption is wrong on this phone (switch to rolling segments).
    5. During a meeting take a 1-minute call: the Meeting screen shows "Another app is using the microphone"; after
       Stop an alert says about 1:00 was silent.
    6. Record over 60 minutes, Stop; with keys set, transcription runs in pieces and tapping a line seeks to it.
    7. HyperOS: battery saver at default, screen off 30+ minutes during a meeting; note whether it keeps recording,
       and that the save offer appears if it was killed. Repeat with "No restrictions".
    8. Tap the meeting notification: it opens the Meeting screen.
    9. A short voice note records, stops and saves; the mic while a meeting records says "A meeting is recording".
    10. Voice note with the screen off: record, lock the phone 1 minute, unlock, stop. The note plays the whole span
        (before 9970a3fb the locked minute was missing).
    11. Open a voice note or meeting with a transcript: "Minutes" with "Make minutes"; nothing sent before the tap.
        Tap: "Making minutes…", then a summary, Decisions and Action items with owner, due and times.
    12. Tap a decision: the player jumps there and plays the matching words. Leave and come back while making: still
        "Making minutes…", then the result.
    13. "Make minutes again" asks "Replace these minutes?"; Replace swaps them.
    14. Airplane mode, Make minutes: "Nexus couldn't reach the AI service. Check your connection, then try again." With
        no Groq or Gemini key: the message says no API key is set.
    15. "Keep out of Nexus" on that recording: Minutes disappear; "Add to Nexus": "Make minutes" again, nothing made
        automatically.
    16. A meeting over 30 minutes: minutes come back as one; on a free Groq key note whether the per-minute limit stops
        it. An Urdu or Arabic transcript: minutes in that language with working times.
    17. Library search for a word only in a decision: the item shows with that line; an Arabic or Urdu minutes word
        typed without harakat or with the other kaf/yeh form finds it.
    18. Ask about that decision: the answer cites the recording with a time; the citation seeks there. Make minutes
        again with other content: the old word no longer finds it, the new one does. Keep it out: minutes words no
        longer find it, transcript words still do.
    19. Right after making minutes the item status shows working briefly, then the same "N ideas, N links".
    20. The Library "+" sheet shows "Scan text" once; Scan text reads English, not Arabic (English model only).
    21. Chrome, a page, Share, Nexus: one row "Link, saved as a note"; Add: a note with title and URL that opens.
        Share again and Cancel (and again with Back): nothing added.
    22. Files, a PDF, Share, Nexus, Add: a PDF item and the editor opens. Gallery, 3 photos: three "Photo" rows and
        "Add 3". 11 photos: "You can add up to 10 files at a time".
    23. WhatsApp voice note, Share, Nexus: "Voice recording"; Add: it plays and, with keys, gets a transcript. An M4A
        over 25 MB is accepted and transcribed in pieces. An AMR or 3GP file: "Nexus can't read this kind of audio yet."
    24. A long text (over 200 words with a link) becomes a "Note". With Nexus swiped away, share a PDF: it cold-starts
        on the Add screen. A video and a mixed PDF + photo share do not list Nexus. HyperOS shows "Nexus" with its icon.
    25. Scan, a scan's "Share images" and a page's "Share image" into another app (Gmail, Files): the images arrive and
        open (they now come from `cache/pdfscan-share/`).
    26. From a test app (or `adb shell am start -a android.intent.action.SEND -t application/pdf --eu
        android.intent.extra.STREAM content://0@com.haroon.pdfeditor.pdfscan.fileprovider/share/x -n
        com.haroon.pdfeditor/expo.modules.audiochunks.android.ShareActivity`): the Add screen shows "Nexus only takes
        files that another app shares with it." and nothing is copied.
    27. Keep out mid-transcription: record a meeting over 52 minutes (or share an M4A over 25 MB) with keys set; while
        the item says Transcribing, tap "Keep out of Nexus". Groq usage stops growing after at most the piece in
        flight, the item has no transcript, and `files/library/<id>/transcribe/` is gone
        (`adb shell run-as com.haroon.pdfeditor ls files/library/<id>`).
    28. Two shares in a row: share a PDF to Nexus and, while "Add to Nexus?" shows, share three photos from Gallery. The
        screen shows "Getting it ready…" then the three photos; Add adds the photos only, and the PDF is not added.

- 2026-11-24 S6 (eco E2, branch `eco/nexus`): AI through AI hub, hub first and own keys second.
  - `src/nexus/hub-first.ts` (pure, tested with a fake hub in `hub-first.test.ts`) wraps the own-key port. Every
    call goes to AI hub first; the own keys serve it when the hub can't (`canFallBack`: hub-missing, not-allowed,
    version, no-key) or when its reply can't be stored. Other hub errors become `AiError`s (busy -> rate,
    timeout/provider-error/cancelled -> server, too-large/invalid -> bad_request), so the queue pauses or retries
    as before and the own keys are not tried.
    - Embed: `dimensions: 512`; the client sends batches of 8. A reply whose `dims` is not 512, whose `model` is
      not `gemini-embedding-001` or with the wrong count goes to the own keys for that call; vectors are
      re-normalised (`unit`, Gemini normalises only 3072-size ones). `EMBED_TAG` is unchanged.
    - Transcribe: `segments: true` (apiVersion 2; an older hub answers `version` before anything is sent, then the
      own key). Segments come back in the own path's shape (trimmed text, `startSec`/`endSec`). The piece-wise
      chunking, per-piece files and the keep-out check before each piece are unchanged: each piece goes to the hub
      or to the own key.
    - Vision: the item's `image.jpg` file goes to the hub when it is 1 byte to 7 MB; larger, base64 to the own key.
      `readImage` now takes the file (`ImageFile`), not base64.
    - Chat (`extract`, `answer`, `complete`): the same prompts (now exported from knowledge-core `openai.ts`:
      `extractMessages`, `answerMessages`, `IMAGE_PROMPT`, `unit`; `EMBED_MODEL` from `providers.ts`).
  - `ai.ts`: `hasKeys()` is now `aiReady()`: both own keys saved, or the hub answers `available(2)` (checked at
    most once a minute) and has not said not-allowed in the last 10 minutes. `ai_source` (`hub`, `own`, `none`) is
    written to `files/ai_source` when it changes. `hub-binding.android.ts` binds `aiHub`; `hub-binding.ts`
    (iOS) has no hub, because the client is Android only and `requireNativeModule` would throw on iOS.
  - Copy: the Stream and CV "AI is off" notices mention turning Nexus on in AI hub; AI settings says what goes
    through AI hub; the Minutes notice, replace prompt and button hint say "Groq or Gemini" (through the hub the
    hub picks; with own keys it is Groq, then Gemini). "Process everything" shows when `aiReady()`.
  - (my call) decisions:
    - Also check the embed `model`, not only `dims`: another model at 512 would break search just as silently.
    - Every hub chat asks for `maxTokens: 8192` (the hub's cap): its default 2048 would cut a long graph or
      minutes reply, and the own path sets no cap. Graph extraction runs at `background` priority.
    - The hub has no JSON mode, so `extract` and `complete(json)` take the text from the first `{` to the last `}`
      (`jsonPart`) before parsing; minutes and CV validators then work as before.
    - not-allowed is remembered in memory for 10 minutes (a new app start asks again); other fall-back kinds are
      not remembered.
    - provider-error maps to `server` (uses an attempt), not `offline`: the hub's kind does not say whether the
      phone is offline, and pausing on a real refusal would keep the item first in the queue forever.
    - `ai_source` lives in a plain file, not secure-store (not a secret, written on change only).
  - Gates: the S6 gates line in "Current state".
  - Not run (phone; main session's coord queue, Store installs only):
    1. AI hub not installed, own keys set: add a note; it gets ideas; `adb shell run-as com.haroon.pdfeditor cat
       files/ai_source` prints `own`.
    2. AI hub installed, Nexus not allowed, no own keys: open Nexus; AI hub's Apps list shows Nexus "Asked to use
       AI. Allow?". Add a note: Stream shows "AI is off" after the first try, nothing is sent, `ai_source` is `none`.
    3. Same with own keys set: the note is processed with the own keys (`ai_source` `own`).
    4. Allow Nexus in AI hub, remove the own keys, reopen Nexus: a note gets ideas, Ask answers with citations, a
       photo gets its text, a voice note gets a transcript with tappable times, Make minutes works, the CV maker
       writes a CV; `ai_source` is `hub`. AI hub's usage shows the calls.
    5. Hub on: Library search and Ask still find items embedded before (same tag, 512 dims): no re-embedding.
    6. Hub on, a recording over 25 MB: transcribed in pieces through the hub; times run through the recording.
    7. Hub on, a photo over 7 MB (if the camera makes one): read with the own Gemini key.
    8. Turn Nexus off in AI hub while it is used: the next call falls back to the own keys (or pauses without them).


Nexus 1.4.0 (versionCode 18) is on the Store, built from `nexus` at a88538e8. PR #44 was merged to main on 2026-11-18.

AI today (#54, #57, #64; `packages/knowledge-core/src/providers.ts`): Gemini embeds text and reads
images, Groq transcribes (Whisper), and chat (`extract`, `answer`, `complete`) tries Groq's keys, then
Gemini's. Several keys per service, kept in expo-secure-store. No OpenAI.
On `eco/nexus` (S6, E2): every AI call goes to AI hub first (`src/nexus/hub-first.ts`) and to these own keys only
when the hub can't serve it; same providers, same data. S6 gates: app tests 92/92 (78 + 14 in `hub-first.test.ts`),
typecheck and lint exit 0; knowledge-core 110/110, typecheck exit 0; library-core 106/106; `expo export --platform
android` exit 0 (bundle holds the hub client); `:audio-chunks:testDebugUnitTest :ai-hub-client:testDebugUnitTest
:app:assembleDebug` BUILD SUCCESSFUL (audio-chunks 22/22, ai-hub-client 12/12); merged manifest and APK (aapt2) hold
`uses-permission com.haroon.permission.AI_HUB`, its `<permission>` with protectionLevel signature and
`<queries><package com.haroon.aihub/>`. Phone checks S6 1-8 not run.
Merged to main: the CV maker as #64 (6981cf70), location reminders as #65 (22e72423), the keep-out
feature as c3b6a309 and 68006565 (both `[skip ci]`, no PR number).

Keep-out feature (S2 above): on the `nexus-keep-out` branch, released to the Store after the owner's go
on 2026-11-20 and installed from the Store on the phone for testing. Test checklist: the Library item
menu's "Keep out of Nexus" removes its ideas from Stream and Ask, and "Add to Nexus" indexes it again.

Wave 2 (S5) is on `eco/nexus` (HEAD after the S5 docs commit), not pushed, not released: Meeting mode,
Minutes, searchable minutes, share targets with the security fix, the voice-note screen-off fix. All gates
green; nothing tried on the phone yet.

Next step: the security-engineer review is done and its findings fixed (S5 log); the code review of chunk
persistence, the Meeting service and Minutes quality was not run (dispatch cap). Then the phone
test through the coord queue (`device:49kjmnuwonkffqzh`), installing from the Store only, with the 28
steps in the S5 log. Then the owner decides on Arabic/Urdu OCR (sizes in the S5 log) and on merging and
releasing `eco/nexus`.

Known shortcuts: first ~24k characters per item feed the graph; brute-force vector search; a Minutes run
that hits the free-tier Groq rate limit repeats the whole run on the next tap (window results are not
kept); the Library body is read and written in two transactions (`indexBody`), so a transcript and minutes
saved at the same instant can leave the older body until the next change; no open-source notices screen
(Leptonica, IJG, libpng ask for one); offline OCR text never reaches Nexus; shared links are stored as notes
and never fetched; a shared PDF is indexed only once it is opened in the editor; a voice note killed
mid-recording is lost (use Meeting); a share is copied into `files/shared-inbox/` before the Add tap (up to
250 MB a share, swept after a day), so another app can fill storage by sharing over and over; a sending app
whose provider never answers keeps the invisible ShareActivity waiting (no timeout). Done in S4 on `eco/nexus` (phone test pending): cited PDFs open at the
cited page (aeae7091); recordings over 25 MB are transcribed in pieces on Android (5624026f); the tab bar
hides while the keyboard is open (6134b70e).

## OCR licence audit (C8)

Checked 2026-11-23 (Nexus wave 2, task 4) from the sources, not from memory. Offline OCR is `packages/text-ocr`
(Android only), used by the Library's "Scan text" screen (`app/scan-text.tsx`).

| Component | Version | Licence | Where verified |
| --- | --- | --- | --- |
| Tesseract4Android (`cz.adaptech.tesseract4android:tesseract4android`, JitPack) | 4.9.0 | Apache-2.0 | `packages/text-ocr/android/build.gradle`; Gradle cache POM and `.module` (the POM names no licence; its only dependency is `androidx.annotation:annotation:1.3.0`, Apache-2.0); AAR sha256 `bce5d641…cb2a` matches the `.module`; GitHub `adaptech-cz/Tesseract4Android` tag 4.9.0 licence API and README |
| Tesseract OCR (inside the AAR, `libtesseract.so`) | 5.5.1 | Apache-2.0 | `tesseract4android/src/main/cpp/tesseract/src/VERSION` and `LICENSE` at tag 4.9.0 |
| Leptonica (`libleptonica.so`) | 1.85.0 | BSD-2-Clause style (Leptonica licence) | `cpp/leptonica/src/leptonica-license.txt` at tag 4.9.0; version from the README |
| libjpeg (`libjpeg.so`) | 9f (14-Jan-2024) | IJG licence | `cpp/libjpeg/src/jversion.h` and README "LEGAL ISSUES" at tag 4.9.0 |
| libpng (`libpngx.so`) | 1.6.48 | PNG Reference Library License v2 | `cpp/libpng/src/LICENSE` and README at tag 4.9.0 |
| `eng.traineddata` (tessdata_fast) | tessdata_fast `main` | Apache-2.0 | Bundled at `packages/text-ocr/android/src/main/assets/tessdata/`; sha256 `7d4322bd…70b2`, 4,113,088 bytes, pinned by `verifyEngTraineddata` in `build.gradle` (runs before `preBuild`); its git blob id `bbef4675…` equals upstream `tesseract-ocr/tessdata_fast/eng.traineddata` (GitHub contents API); repo licence Apache-2.0 |

- F-Droid: every licence above is FOSS. The JitPack AAR ships prebuilt `.so` files, so an F-Droid build would
  have to build Tesseract4Android from source (srclib) instead of taking the JitPack binary. Nexus ships through the
  private Store only, so this does not block anything today.
- Attribution: Leptonica's BSD licence, the IJG licence and libpng's licence ask for their notices in the
  documentation of a binary distribution. The app has no open-source notices screen yet (open finding).
- The app ships arm64-v8a only, so only the arm64 `.so` files (about 7.5 MB) go into the APK.
- Language coverage: English only. Arabic and Urdu need an owner decision (tessdata_fast `ara.traineddata`
  1,432,056 bytes, `urd.traineddata` 1,398,718 bytes, or `script/Arabic.traineddata` 9,311,038 bytes; sizes from
  the GitHub contents API, nothing downloaded).
- What reaches Nexus: nothing. "Scan text" saves nothing (it copies text to the clipboard); `scan` items have an
  `ocr_text` column that nothing fills yet; `image` items are read by Gemini vision, not by the offline OCR.

## P3 (eco Wave 3): Ask my life, due dates, shares

Branch `eco/nexus`. Later workers (M3 buttons, B6 receipts) append their own parts below. Rulings R1 to R11 are the phase agent's
calls, summarised here and marked "(my call)": nothing in the owner's brief fixed them.

### What Ask my life (B2) does
- Settings, "Ask my life": one On/Off switch per source, all off by default: Inflow messages, Clipboard pinned clips, Deputy run
  history. The switches live in `kn_meta` (`source_switch:<app>`, same database as the items they guard); `today_share` is the
  fifth flag there.
- On: `SourceSync.turnOn`, then a first run. Off: asks "Delete everything Nexus kept from <app>?"; on confirm `SourceSync.turnOff`
  wipes items, chunks, vectors and search rows at once, then Library, Stream, Ask and any open item screen refresh (a deleted item's
  screen shows "Not found"; a Library view of the vanished "From <app>" folder steps back).
- Runs (`src/nexus/ask-sources.ts`, pure part `ask-runner.ts`): when the app opens and when it returns to the foreground, one
  `SourceSync` per process, at most 50 new items per source per run, never overlapping (a request during a run becomes one more run
  after it), no timer and no background service. After a run that added or changed items the existing worker is kicked, so
  embeddings go Gemini via the hub-first wrapper; Ask answers go to Groq (hub first when AI hub is installed). The switch copy says so.
- A source that is off, missing or fails keeps its data and shows one plain line ("Off in Inflow", "Couldn't read Inflow right now").
  Every switch also shows a fixed hint naming the other app's own switch (R9). Status lines come from the last run, so nothing is read
  from another app while its switch here is off.
- Source items: read-only on the item screen (text from `kn.segmentsOf`, label "From Inflow message, 3 Nov" in the header), Keep out of
  Nexus / Add to Nexus, no editor, no due date, no Delete or Rename (a deleted Deputy run or pin would come back on the next run; a
  rename would be overwritten). Library rows and search hits show the source label instead of kind, date and size. Citations show
  `origin ?? title`. Nothing is opened or fetched from source text.

### What is served to other apps (R3)
- `files/today.json` (filesDir, where `ai_source` goes; `Paths.document` is `Context.getFilesDir()` in expo-modules-core 3.0.30):
  `{"v":1,"on":bool,"items":[{"title","dueAt"}]}`. Items are the owner's own items due from local midnight to local midnight + 3
  days (`Library.dueBetween`, source items excluded), soonest first, at most 100, titles only (control characters and line breaks
  become a space, at most 200 UTF-16 units, blank ones skipped), `dueAt` whole epoch ms, the whole file at most 64 KB. Switch off
  writes `{"v":1,"on":false,"items":[]}`. Written through a temp file moved into place, only when the text changed, on app start,
  foreground, a due-date change, a rename or note retitle, a delete and a switch change. The provider in `nexus-links` keeps only
  what is due today (local time) at query time.
- Settings, "Other apps": "Show what is due today in my other apps", off by default.
- `files/last_seen`: decimal epoch ms, on app open, foreground and after worker steps, at most once a minute.
- Due dates (R1): item screen "Due" row, quick picks Today, Tomorrow, In a week (end of that local day) and Clear, no date-picker
  dependency; the date also shows under the item title.

### Rulings (my call)
- R1 `item_due` table and quick picks, no date picker. R2 new Android-only module `nexus-links`. R3 `today` and health are served
  from small files JS writes; Kotlin filters "today" at query time. R4 source items are `kind='note'` items in an automatic
  "From <app>" folder, embed-only (no graph extraction, no Groq per message). R5 Inflow shares mirror the planned columns until
  eco/inflow commits them. R6 snapshot is the truth for runs and pins; Inflow uses `ask_ids`. R7 ADD_TODO sends `dueAt` only from a
  real `item_due`. R8 source items show in Library in their folder, 50 new per source per run. R9 Deputy and Clipboard answer
  empty while their switch is off, so "Off in <app>" shows only for missing or refusing providers, plus a fixed hint. R10 Clipboard
  `pinned` is paged, read up to 10 pages, cap hit means unreachable. R11 a bad row in a snapshot or id list fails the whole read; in
  item reads it is skipped. W4's own: Source switches and the today flag in `kn_meta`, not a file (one database, one wipe); Keep out
  offered on source items, Rename and Delete not.

### Not run (phone; main session, coord device claim first, Store installs only)
1. Ask my life, Inflow: in Inflow turn on "Let Nexus read my messages"; in Nexus Settings, Ask my life, switch "Inflow messages" On.
   Expect the line "Nexus keeps N items from Inflow", a "From Inflow" folder in Library, and a message found by Ask with the
   citation "From Inflow message, <day>" that opens read-only (no editor, no Delete). A bank one-time code never appears.
2. Switch it Off: confirm "Delete everything Nexus kept from Inflow?". The folder, items and Ask citations are gone at once; an open
   item screen of one shows "Not found"; Inflow is unchanged. Cancel the prompt: still On.
3. With Inflow's switch off or Inflow not installed: Nexus shows "Off in Inflow", keeps what it had.
4. Deputy and Clipboard: same flow with their own switches ("Let Nexus read my run history", "Let Nexus read pinned clips"). Finish a
   Deputy task, reopen Nexus: a "Deputy run, <day>" item; unpin a clip: its item goes on the next open.
5. Due: open an own note, tap Today, Tomorrow, In a week, Clear. The date shows under the title and in the Due row.
6. Today share: Settings, Other apps, On, with an own item due today. A Store-signed sibling reading
   `content://com.haroon.pdfeditor.applink/today` gets that title with its due time. Off: no rows. Switch Off again: no rows. (From
   the adb shell the read is refused, because the shell lacks the signature permission; that refusal is the point.)
7. Heartbeat: open Nexus, then read `health` from a sibling: last_seen_at within a minute of now.
8. Open the app twice within a minute: `files/last_seen` changes at most once a minute (needs `adb shell run-as com.haroon.pdfeditor cat files/last_seen` on a debuggable build only).

### M3 action items: Add to Inflow and Do with Deputy
- Where: each Minutes action item on an audio item screen, and the note screen (one pair under the note field). Not on source items
  (text from other apps is not sent onward) and not on decisions. Small secondary buttons "Add to Inflow" and "Do with Deputy",
  hidden when the platform has no `NexusLinks` (iOS). One tap sends one item through `startLink` from the button's onPress only;
  there is no bulk send, no notification, shortcut, widget or background caller. Both buttons are disabled while a launch is open
  (the native side also answers `busy`). The outcome sits under the buttons for 6 seconds or until the next tap.
- Add to Inflow (`ADD_TODO`, Inflow shows its own screen and saves only on Add): `title` is the item text, whitespace collapsed and
  control characters removed (NUL included), cut to 200 UTF-16 units at a word (never inside an emoji, no ellipsis). If it was cut,
  the full cleaned text follows in `note`. `note` also holds the source line ("From the minutes of <title>", "From a Nexus note") and,
  for a Minutes item, "Owner: Sara. Due: by Friday." as plain words. `dueAt` (camelCase) is sent only for an own note with a real
  due date (`item_due`); a spoken due is free text and never becomes `dueAt` (R7). `source` is "Nexus".
- Do with Deputy (`PROPOSE_TASK`, Deputy shows its draft screen and runs nothing until the owner starts it there): `task` is the
  fixed sentence "Do this for me. The details are in the quoted text." written by Nexus, never built from item text. `context` is the
  cleaned item text cut to 2000 and is untrusted at Deputy. No `apps`, no `ref`. Context is cleaned like the title, so line breaks
  become spaces.
- Outcomes (plain text): "Added to Inflow." / "Sent to Deputy. Check it there before it runs."; "You didn't add it." / "You didn't send
  it."; "Inflow isn't installed." / "Deputy isn't installed."; refused or failed "Inflow didn't accept it." / "Deputy didn't accept it.
  Nothing was sent."; busy "Wait a moment and tap again."
- Code: pure builders and `outcomeText` in `src/nexus/action-links.ts`, tests in `src/__tests__/action-links.test.ts` (run against the
  contract's `validateExtras`, `ADD_TODO` and `PROPOSE_TASK`, and the fixture specs); buttons in `src/nexus/send-buttons.tsx`; wired in
  `app/item.tsx`. No native change.

Not run (phone), after M3:
1. Inflow installed: open a recording with minutes, tap "Add to Inflow" on an action item. Inflow asks for the fingerprint and shows its
   screen with the text and the source line in the note. Tap Add: "Added to Inflow." appears under the buttons and clears in about 6 s.
   Back instead: "You didn't add it."
2. Uninstall Inflow: "Inflow isn't installed." Tap twice quickly with it installed: the second tap is ignored (buttons disabled).
3. Deputy installed: "Do with Deputy" opens its draft screen with the fixed task and the item text as quoted context; saving it: "Sent
   to Deputy. Check it there before it runs." Back: "You didn't send it." Deputy uninstalled: "Deputy isn't installed."
4. An own note with a due date set (Due row), "Add to Inflow": Inflow shows that due date. A Minutes item shows none, with "Due: by
   Friday." in the note when the speaker said it.
5. A source item ("From Inflow") and a decision row show no buttons. On iOS no buttons appear.
6. Layout of the buttons under an action row and the note field is unseen (typed and read only).

### B6 receipts: read a receipt, match it to an Inflow payment, optional warranty reminder

What it does. On a scan (Library, scan screen) "Read as receipt" opens `app/scan/receipt.tsx`. It reads the first page, shows amount, date,
shop and an optional warranty end as four editable fields (the owner's edits go through the same checks as the model's reply), and a
"Match to Inflow" button. The match runs on the phone against Inflow's `debits` share (switch "Let Nexus match my receipts" in Inflow).
The owner always answers: "Yes, it matches" / "No" for one result, or pick one of up to three, or none. A "Remind me" button appears
when the warranty end is valid; it asks Inflow's `ADD_TODO` through `startLink` on that tap only (Inflow shows its own screen first).

The rules.
- Transactions are never indexed into Ask, never written by Nexus (no Library, kn_meta, file or log write), never sent to any AI. Only
  the receipt photo is read by the existing hub-first wrapper (`ai.readImage`), then its text goes to `ai.complete` inside the fixed
  prompt `RECEIPT_PROMPT` (fenced, "untrusted data", JSON only). No debit row or Inflow field is ever in a prompt; the screen holds the
  matched rows in memory only until the owner answers, then keeps only a sentence ("Matched with ... Nexus didn't save it.").
- Pure code, tests first: `receipt-parse.ts` (reply and field validation, `RECEIPT_PROMPT`), `receipt-match.ts` (`matchReceipt`),
  `receipt-reminder.ts` (`warrantyReminder`), `receipt-debits.ts` (paging and the plain lines), `receipt-read.ts` (the two AI calls
  behind a port). Glue only in `app/scan/receipt.tsx`. No native, Gradle, dependency or lockfile change.
- Parse: first JSON object in the reply (fence or prose allowed); amount is a number or a plain decimal string, converted to minor units
  (x100, rounded), 1..10^12; date is a real calendar day, 2000 or later, at most tomorrow; shop is cleaned (control characters out)
  and cut to 80; warranty end must be a real day after the purchase and within 30 years, otherwise only it is dropped.
- Match: same `amount_minor` (nothing else about currency is compared), the debit within 3 local calendar days (DST-safe), then a
  name check (accents, case, punctuation and legal suffixes ignored; shared words or bigram Dice/Jaccard at least 0.5, or one name
  holds the other; Arabic and Urdu script names only by containment). Same amount and days but another name is `weak`: it is only ever
  listed for the owner to pick, never offered as "this looks like".
- Reading: `readDebits` pages are read forward (oldest first by id, 200 a page) until an empty page, at most 10 pages. A failing later
  page, a page that does not move on, or the page cap is "Couldn't read Inflow right now." Inflow serves only the last 60 days
  (newest 500 debits), so an older receipt finds nothing.
- Lines: off "Off in Inflow. Turn on 'Let Nexus match my receipts' in Inflow."; missing "Inflow isn't installed."; failed "Couldn't
  read Inflow right now."; none "No matching payment found yet."; weak "Amount and date match, the name doesn't. Is one of these yours?"

(my call)
- The photo read keeps the app's fixed image prompt (`ai.readImage` has no prompt argument), so the receipt JSON comes from a second,
  text-only `ai.complete` call on the text that read gave back. Nothing but the receipt's own text goes through it.
- Nothing is stored about the receipt, the match or the reminder (no "already matched" memory): the simplest choice.
- Equal name score and equal day gap = `tie`; if two debits fit the name equally well, the nearer day wins and is offered as the one
  match (the owner still confirms). The brief read "equal top scores = tie".
- A comma used as a decimal ("12,50") is refused rather than guessed; "1,234.50" with thousands commas is accepted.
- Only the first page of a scan is read; the warranty date stays editable by typing YYYY-MM-DD (no date picker).
- The "Remind me" note says "Warranty for <shop> ends on 20 Nov 2028. Receipt scanned in Nexus." (readable date), set after
  `addTodoExtras` builds title, source and `dueAt` (its note label cap is 100, too short for a long shop name).

Not run (phone), after B6:
1. Scan a receipt (Library, Scan), open it, tap "Read as receipt": fields fill in a few seconds. Edit the amount to "12,50": the field
   shows an error and "Match to Inflow" is disabled; "12.50" works again. With no AI keys and AI hub off: "Nexus needs an AI service".
2. Inflow switch off: "Match to Inflow" says "Off in Inflow. Turn on 'Let Nexus match my receipts' in Inflow." Switch on with a payment of
   the same amount, within 3 days, same shop: "This looks like your ... payment of 12.50 on 20 Nov. Is it the same?" Yes: "Matched with
   ... Nexus didn't save it." Leave and come back: nothing is remembered.
3. Same amount and day, different shop: the weak line with up to three rows plus "None of these". Two equal payments: a list to pick from.
   No payment: "No matching payment found yet." Inflow uninstalled: "Inflow isn't installed."
4. Warranty field 2028-11-20 (or the model's): "Remind me" opens Inflow's screen with "Warranty ends: <shop>", due 14 days before
   at midday; Add gives "Added to Inflow.", Back "You didn't add it." A warranty ending in under two weeks shows the no-time line.
5. Layout of the four fields, the match rows and the buttons is unseen (typed and read only).
