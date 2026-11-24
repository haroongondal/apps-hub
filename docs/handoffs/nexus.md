# Handoff: Nexus (AI knowledge layer for PDF Editor)

## Resume prompt

Dated 2026-11-24. Task: phone-test the Nexus CV maker (merged to main as PR #64). Work in
`/Users/outsentia/Documents/apps-hub/.claude/worktrees/nexus-cv` (branch `nexus-phone-test`, cut
from main 1ba92561; this handoff edit is uncommitted). Read `docs/handoffs/nexus.md` completely
first. Trust the verified facts below and don't re-derive them, especially the S4 entry and
"Current state + exact next step". Follow the handoff contract in `~/.claude/CLAUDE.md`: keep the
session log and current state up to date as milestones land, and near 85% context finalise the
state and print a new resume prompt. Real phone only, never an emulator; claim `device:49kjmnuwonkffqzh`
in coord first. Commit, push or release only when the owner says so.

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

- 2026-11-23 S3: CV maker, branch `nexus-cv` (PR #64), rebuilt on `origin/main` after the first
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

- 2026-11-24 S4: why the CV maker is not on the phone (all verified, read-only on the phone):
  - PR #64 merged 2026-11-23 21:04 PKT as 6981cf70. The phone has `com.haroon.pdfeditor` 1.4.0
    versionCode 23 (Store, updated 2026-11-23 22:24). I pulled its APK: the bundle has none of the
    CV strings ("Make a CV", "Apply with AI", "Export PDF", "New CV"). The CV maker is not installed.
  - CI publishes changed apps on every push to main (`.github/workflows/ci.yml`). The release job for
    the #64 merge (run 45212293496) and for the AI hub merge #66 (run 45210289754, 11 min earlier) both
    failed at `pdf-editor 1.4.0 (24)`: `:react-native-reanimated:buildCMakeRelWithDebInfo[arm64-v8a]`
    link error, 14 `undefined symbol: worklets::...`. #64 did not cause it (no lockfile or native
    dependency change). Later pushes did not touch pdf-editor, so nothing retried: 1.4.0 (24) was
    never published.
  - Reproduced locally: a from-scratch `./gradlew :app:assembleRelease` of main 1ba92561 fails the same
    way (7 min). Afterwards `libworklets.so` (under `node_modules/.pnpm/react-native-worklets@0.5.1*/
    node_modules/react-native-worklets/android/build/intermediates/cmake/release/obj/arm64-v8a/`) is
    0 bytes and exports no worklets symbols. One worklets install only; disk fine. Root cause not found.
    Not tried: re-running `assembleRelease` without `clean` (a race would show as a pass).
  - Last good: a from-scratch build of 4154120d (CV on 7cec9912, base d2eeeb02) linked fine in 1m43s,
    and its APK bundle had the CV strings. Build inputs that changed since d2eeeb02: the place-reminders
    module (#65, Kotlin only), the `text-ocr` dependency, and `pnpm-workspace.yaml` (#59 added
    `overrides: supports-color: 8.1.1` for a similar worklets split; it did not fix this).
  - 4154120d is NOT the merged code: it has my own per-key fallback in `providers.ts`/`ai.ts`/`settings.tsx`,
    while main keeps its own key handling (#57: `addKey`/`removeKey`, rotation in `openai.ts`). The CV
    screens, `src/cv/` and the Groq-to-Gemini chat hand-over are the same.
  - My earlier test APK is gone (I deleted `android/app/build`). adb: wireless serial
    `adb-49kjmnuwonkffqzh-zHnffO._adb-tls-connect._tcp`; it dropped once ("device offline", then
    connection refused) and came back after `adb kill-server; adb start-server` and about a minute.
    Check `adb devices -l` first and never kill-server while another session's device is attached.
  - The owner authorised an adb install of a side-by-side test build on 2026-11-23 ("install the latest
    build using adb and test it"); without that the auto-mode checker blocked the install. That OK does not
    carry to a new chat: if blocked, stop and ask the owner. `com.haroon.inflow` build 8 on the phone
    crashes on launch; another session put it there, leave it.

- 2026-11-24 S5: phone test started. Claimed `device:49kjmnuwonkffqzh` (adb over USB, serial
  `49kjmnuwonkffqzh`, state `device`; owner used the phone ~3 min earlier, aihub in front). Applied the
  temporary build edits (applicationId `com.haroon.pdfeditor.cvtest`, release `debuggable true`, app_name
  "Nexus CV test") and started `:app:assembleRelease -PreactNativeArchitectures=arm64-v8a` without `clean`
  (log in the session scratchpad `build1.log`).
  - **Main build still fails, four tries (all verified):** (1) plain `assembleRelease` without clean: same
    reanimated link error in 11 s, `libworklets.so` 0 bytes (3 hard links to one inode). (2) deleted
    worklets' `android/build` and `.cxx`, rebuilt: the 33 worklets objects compile, ninja prints
    "Linking ... libworklets.so", exit 0, file is 0 bytes; reanimated then fails with 14 undefined
    `worklets::` symbols. (3) Extracted ninja's own link command (`ninja -t commands libworklets.so`) and ran
    it by hand with bash: **13 MB, valid**. So clang and the objects are fine; the 0 bytes appear only when
    Gradle/ninja drive it. (4) Re-ran Gradle after the manual link, and again with `-x
    ':react-native-worklets:buildCMakeRelWithDebInfo[arm64-v8a][worklets]'`: all five copies of
    `libworklets.so` are 0 bytes again afterwards, so something else in the Gradle run (a copy/prefab task or
    ninja relink) truncates it. Root cause not found; this is the owner's separate task (Store release of
    pdf-editor is blocked by it).
  - **Plan B worked:** `git worktree add --detach ../nexus-cv-4154 4154120d` (a separate worktree so this
    handoff edit is untouched), `pnpm install --frozen-lockfile`, editor build, the three temporary edits,
    `:app:assembleRelease -PreactNativeArchitectures=arm64-v8a`: BUILD SUCCESSFUL in 2m 6s, a from-scratch
    build. APK `.../nexus-cv-4154/apps/pdf-editor-mobile/android/app/build/outputs/apk/release/app-release.apk`
    (43 MB). `aapt2`: package `com.haroon.pdfeditor.cvtest`, label "Nexus CV test", debuggable; bundle has
    "Make a CV", "Apply with AI", "Export PDF", "New CV" (1 each); `libworklets.so` in the APK is 860 KB.
    This is 4154120d, not merged main: key handling differs (see S4); CV screens and `src/cv/` match.
  - `adb -s 49kjmnuwonkffqzh install` (no `-r`): Success. Store Nexus after: still `com.haroon.pdfeditor`
    1.4.0 versionCode 23. Test app: versionCode 1, DEBUGGABLE.
  - Waited until the owner had been idle 2+ min (lastUserActivityTime, not in a call, unlocked) before any
    input. **No-key tests, all on the phone, screenshots in the session scratchpad `shots/`:**
    - PASS launch: tabs Stream, Library, CV; Stream shows "AI is off" + Add your key (fresh empty data).
    - PASS CV tab empty: "No CVs yet", Make a CV button.
    - PASS New CV, no keys: "AI is off" notice, Create CV dimmed; with text typed it stays dimmed and a tap
      does nothing. "Add your keys" opens AI settings (copy mentions the CV maker).
    - PASS fake Groq key `gsk_test` + Check and save: "The AI service refused the API key (HTTP 401). Check
      your key in AI settings." Nothing saved: New CV still "AI is off" after closing settings.
      Nit: "Check your key in AI settings" is shown inside AI settings.
    - PASS seeded CV (`run-as` + `files/cv/seedcv1.json`) appears as "Modern · edited 24/11/2026"; opens
      with Template, Sections (Remove per section), Change with AI (Apply with AI dimmed), Share, Delete.
    - PASS template switch Classic, Minimal, Modern: each persists after leaving and reopening (list label
      and editor both follow). PASS Remove Summary: persists after reopening.
    - PASS Export PDF: share sheet opens with `Haroon_Mukhtar-CV.pdf`; closed with X, nothing shared.
      Pulled `cache/Haroon_Mukhtar-CV.pdf` for each template (1 page, ~2 KB), rendered with qlmanage:
      Classic centred serif with rules and capitals; Modern teal band, sans; Minimal plain left sans. Name,
      title, contact line, Experience entry with dates and bullet all correct; the removed Summary is absent.
    - PASS Delete this CV: confirm dialog, then `files/cv` empty and the list is "No CVs yet".
    - Findings (minor): (a) the delete dialog buttons render ALL CAPS ("CANCEL", "DELETE"), against the
      sentence-case rule (AI hub #70 fixed the same); (b) the exported PDF stays in `cache/` after the CV
      is deleted, and the dialog says "removed from this phone"; (c) the wording nit above.
    - Not tested: Arabic/Urdu (known shortcut), multi-page overflow, and everything that needs keys.
  - Temporary build edits REVERTED in nexus-cv (`git status`: only this handoff is modified). nexus-cv-4154
    still has them and holds the installed APK's build; remove it with `git worktree remove --force
    ../nexus-cv-4154` when the whole test is over (my own scratch).
  - Released `device:49kjmnuwonkffqzh` at the end of the no-key tests because another session
    (Design Editor 25 Store test, session `local_05738f22-...`) was queued. Re-claim before the AI tests.
    Test app `com.haroon.pdfeditor.cvtest` stays installed, empty (no CVs, no keys).

- 2026-11-24 S5 (cont.): owner said "use AI hub for AI calls" and chose "Build the hub client, route CV
  calls" (not all of Nexus). Facts checked first: the hub is on the phone (`com.haroon.aihub` 0.1.1, vc 3)
  with `AiHubService` (action `com.haroon.aihub.BIND`) behind signature permission
  `com.haroon.permission.AI_HUB`; all three packages (hub, Store Nexus, test app) carry signature
  `c5be01b8`, so the test app may bind. `packages/ai-hub-client` (plan P3) did not exist.
  - Built (uncommitted, in nexus-cv): `apps/pdf-editor-mobile/modules/ai-hub-client` (Expo local module,
    Kotlin only: copy of the hub's two AIDL files kept in package `expo.modules.aihubcore`, `HubClient.kt`
    binds per call and returns result JSON or a coded error, manifest with the permission and `<queries>`);
    `src/nexus/hub-port.ts` (pure: `hubComplete` sends `{apiVersion 1, job chat, priority foreground,
    messages, maxTokens 4096}` and returns `text`; `hubStatus` = installed and at least one key),
    `src/nexus/hub.ts` (Expo glue); `app/cv/new.tsx` and `app/cv/[id].tsx` use `hubAi`, the "AI is off"
    notice became "AI hub isn't ready" with the hub's message; copy says "AI hub, which asks Groq or
    Gemini". Kept under the app as a local module, not `packages/ai-hub-client` as the plan says: move it
    when a second app needs it. Nexus's own keys and the graph (embed, extract, answer, transcribe) are
    NOT moved.
  - Gates in nexus-cv: `pnpm test` (app) 44/44 incl. new `hub-port.test.ts`, `pnpm typecheck` clean,
    lockfile +9 lines (importer for the new module).
  - **Main still cannot be built, even from a fresh worktree** (`nexus-cv-main`, 4m47s, same reanimated link
    error, libworklets.so 0 bytes). So the hub test APK is built on the 4154120d base in `nexus-cv-4154`
    with my changes ported (patch minus package.json and lockfile; package.json edited by script):
    42/42 tests, typecheck clean there.
  - **Phone test through the hub (owner put keys in AI hub; coord claim held ~12 min, released):**
    - PASS the hub is reachable from the test app: New CV shows no "isn't ready" notice, Create enabled.
    - PASS create CV (Classic, sample text with invented facts) through the hub: first try "Gemini is busy
      or failing (HTTP 503). Try again later." (the hub's own plain error, shown in the field); the retry
      worked after about a minute and gave Sara Khan / Data Analyst with Summary, Experience, Education, Skills.
    - PASS AI edit "Add a Certifications section with AWS Solutions Architect, 2025": section appeared,
      box cleared. BUT the first try failed with "The AI reply was not a CV Nexus could read." Cause
      (inferred, not seen): the hub's chat has no JSON mode, so the reply was fenced or had prose, and
      `readBody` is a strict `JSON.parse`. Fixed in `hub-port.ts`: `jsonObjectIn` takes first `{` to last
      `}` when JSON is asked for, and `maxTokens` is 8192 (hub cap) because a reasoning model spends tokens
      thinking. Tests added (nexus-cv 46/46, 4154 44/44). After the rebuild and reinstall the edit worked.
    - NOT PASSED "Remove the summary": three tries all ended in hub errors, "Gemini is busy or failing
      (HTTP 503)", then "Gemini took too long to answer" twice (each attempt 45-60 s). So it is untested,
      not a Nexus failure. The hub's chat default is Groq (plan), yet every error names Gemini: either
      Groq has no working key in the hub or it handed over after failing, and the hub shows only the last
      service's error. Owner/hub task: check the hub's chat model and Groq key, and consider showing both
      errors.
    - PASS export of the AI-written CV (Classic): facts match the input, Certifications 2025 present,
      nothing invented (rendered with qlmanage).
    - Not done: the Groq-then-Gemini hand-over bullet is moot (the hub owns hand-over); empty-instruction
      and network-off error texts (Apply is dimmed when empty; network was not switched off on the shared
      phone).
  - Cleanup: scratch worktree `nexus-cv-main` removed. `nexus-cv-4154` remains (holds the installed build,
    carries the temporary applicationId/debuggable/app_name edits); remove with `git worktree remove
    --force ../nexus-cv-4154` when finished. Test app `com.haroon.pdfeditor.cvtest` stays installed with one
    CV (Sara Khan). The phone is released.

## Current state + exact next step

**Update 2026-11-24 (S5, latest).** Phone test is done except one AI step. The owner chose to route the CV
maker through the AI hub (not its own keys); the client and wiring are written but UNCOMMITTED in `nexus-cv`
(`modules/ai-hub-client`, `src/nexus/hub*.ts`, the two CV screens, `package.json`, `pnpm-lock.yaml`), tests and
typecheck green. Open items for the owner, in order: (1) say whether to commit and open a PR for the hub client
(commit, push, PR only on their go); the plan wants it as `packages/ai-hub-client` (P3), it is a local module
under the app for now. (2) Main-branch Android release build failure (`libworklets.so` 0 bytes, reproduced on a
fresh worktree) is its own task; it blocks every `pnpm release pdf-editor` from main (a Store build 24 exists, so
a release did get through somehow: check how). (3) "Remove the summary" via the hub is untested: the hub's chat
kept returning Gemini 503/timeouts; check the hub's chat model and Groq key. (4) Minor: ALL-CAPS dialog buttons,
exported PDF stays in cache after delete, AI-settings wording nit (see S5 findings). Original list (steps 1-3
and the no-key part of 4 are done):

1. Claim the phone: `coord claim device:49kjmnuwonkffqzh "Nexus CV phone test"`; if queued, `coord wait`
   in the background. Check `dumpsys power | grep lastUserActivityTime` and `dumpsys window | grep
   mCurrentFocus` before any input; a phone call (`telephony.registry mCallState=2`) means wait.
2. Get an APK. First try (cheap, a few minutes): in `android/` of this worktree run
   `./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a` once more without `clean`, with
   `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` and
   `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`. If it links, the empty `libworklets.so`
   was a first-run race. If it still fails, test from 4154120d instead (see the caveat in S4): `git
   checkout --detach 4154120d`, `pnpm install --frozen-lockfile`, `node ../../packages/pdf-editor-engine/
   build.mjs` in the app dir, then build as above. Do not spend long on the main build failure: report it
   to the owner as its own task.
3. Make it side by side (temporary edits, revert afterwards with `git checkout --` on those two files):
   `android/app/build.gradle` `applicationId 'com.haroon.pdfeditor.cvtest'` and `debuggable true` in the
   `release` buildType (enables `run-as`); `android/app/src/main/res/values/strings.xml` `app_name` "Nexus CV
   test". Verify with `aapt2 dump badging` (package, label) and `grep -a -c "Apply with AI"` on the APK's
   `assets/index.android.bundle`. Install with `adb -s <serial> install <apk>` only: never replace,
   update or uninstall the Store Nexus (`com.haroon.pdfeditor`, real library) or any other app.
4. Test on the phone (screenshots with `adb exec-out screencap -p`, 1080x2400; describe structure, never
   quote the owner's data; no `uiautomator dump`; use ~1500 ms swipes):
   - Launch; tabs Stream, Library, CV are there. CV tab shows "No CVs yet" and a Make a CV button.
   - New CV with no keys: "AI is off" notice, Create CV disabled, "Add your keys" opens AI settings.
   - AI settings: add a fake Groq key (`gsk_test`) and Check and save: expect a refusal message, nothing saved.
   - Seed a CV (the test app is debuggable): write the JSON below to `files/cv/seedcv1.json` with
     `adb push` to `/data/local/tmp` then `run-as com.haroon.pdfeditor.cvtest sh -c 'mkdir -p files/cv &&
     cp /data/local/tmp/seedcv1.json files/cv/'`. It appears in the CV tab; open it. Switch Classic,
     Modern, Minimal (persists after leaving and returning). Remove a section (persists). Export PDF opens
     the share sheet; save or open the PDF and check each template's look in a viewer. Delete this CV.
   - Seed JSON: `{"name":"Haroon Mukhtar","title":"Senior Software Engineer","contact":["haroon@example.com",
     "Lahore, Pakistan"],"sections":[{"heading":"Summary","entries":[{"title":"","subtitle":"","dates":"",
     "lines":["Mobile and desktop engineer who ships privacy-first apps."],"plain":true}]},{"heading":
     "Experience","entries":[{"title":"Senior Software Engineer","subtitle":"Outsentia","dates":"2023 - Present",
     "lines":["Led a React Native and Kotlin team shipping four Android apps."],"plain":false}]}],"id":"seedcv1",
     "template":"modern","updated":"2026-11-24T10:00:00.000Z"}` (one line in the file).
   - AI steps need the owner's Gemini and Groq keys typed by the owner into the test app's AI settings:
     never read them from anywhere, never ask for them in chat. With keys: create a CV from sample text in each
     template; an AI edit "Add a Certifications section with AWS Solutions Architect, 2025" adds a section;
     "Remove the summary" removes one; put a bad Groq key before a good Gemini key to see chat hand over
     from Groq to Gemini. Check the error text when the instruction is empty or the network is off.
5. At the end: revert the temporary build edits, `coord release device:49kjmnuwonkffqzh` and tell the next
   session, record results in the session log (what passed, what failed, with evidence), and leave the test app
   installed (removing it needs the owner's OK). Do not run `pnpm release`, re-run CI releases or merge anything
   without the owner's go.

Older state (2026-11-18 to 11-20), kept for context: Nexus 1.4.0 (versionCode 18) is on the Store, built from `nexus` at a88538e8. PR #44 was merged to main on 2026-11-18.

Keep-out feature (S2 above): on the `nexus-keep-out` branch, released to the Store after the owner's go
on 2026-11-20 and installed from the Store on the phone for testing. Test checklist: the Library item
menu's "Keep out of Nexus" removes its ideas from Stream and Ask, and "Add to Nexus" indexes it again.

Next step: phone test through the coord queue (`device:49kjmnuwonkffqzh`), installing from
the Store only. First check the existing library still opens after the migration (library
step 2 on real data), then: tabs, note capture without a key ("Waiting for an AI key"),
voice note record/stop (and with the screen off), photo, PDF page text; with the owner's key
entered by the owner: transcription, ideas, Ask with citations, seek from a voice
citation, kill-and-resume.

Known shortcuts: cited PDFs open at page 1 (needs a bridge message, N3); recordings over
25 MB fail; first ~24k characters per item feed the graph; brute-force vector search;
no share-sheet ingestion yet; the tab bar rises above the keyboard on the Stream screen.
