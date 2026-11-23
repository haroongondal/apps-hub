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

## Current state + exact next step

Nexus 1.4.0 (versionCode 18) is on the Store, built from `nexus` at a88538e8. PR #44 was merged to main on 2026-11-18.

AI today (#54, #57, #64; `packages/knowledge-core/src/providers.ts`): Gemini embeds text and reads
images, Groq transcribes (Whisper), and chat (`extract`, `answer`, `complete`) tries Groq's keys, then
Gemini's. Several keys per service, kept in expo-secure-store. No OpenAI.
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
