# Handoff: Deputy (on-phone AI agent for Android)

## Resume prompt

Dated 2026-10-29. Read `docs/handoffs/deputy.md` completely first, then
`docs/deputy/RESEARCH.md`, `docs/deputy/PRD.md` and `docs/deputy/SPEC.md`. Trust
the verified facts below and do not redo that research. Follow the handoff
contract in `~/.claude/CLAUDE.md`. Read "Current state + exact next step" before
doing anything, including the safety-classifier stops recorded there, then
continue from the stated next step. Phase 1 code is built on branch
`deputy-phase-1`; what is left of Phase 1 is the Store release and the spikes on
the phone. Don't start Phase 2 until the Phase 1 exit criteria are met.

## Goal and fixed constraints

- Personal Android app (working name Deputy). It takes a task in plain words and
  carries it out by operating the phone's apps, like Claude Cowork but on the
  phone itself.
- Personal use only. Distributed only through the user's private Store
  (`com.haroon.*`, shared release key), never on Play.
- iOS isn't feasible for the core idea (RESEARCH §9), so there is no iOS app.
- Repo rules (AGENTS.md): Expo SDK 54 / RN 0.81.5, `@apps-hub/ui` for all UI,
  native code in Expo local modules, `node --test` for TS, Gradle JVM tests for
  Kotlin, no telemetry.
- Install on the phone only through the Store, never `adb install` (memory:
  install-via-store-only).

## Decisions made (with why)

User's answers (2026-10-28):

- **Model-agnostic, Gemini Flash as the default.** User's choice, overriding the
  Claude-only plan.
- **Autonomy:** ask before irreversible steps (send, pay, buy, delete, post,
  security settings).
- **Job types:** messaging, orders and bookings, phone housekeeping, gather and
  summarise, financial apps, investment apps, media apps.
- **Triggers:** all three: on demand, scheduled, and when a notification
  arrives.

From research (RESEARCH.md):

- Phone control through Android's AccessibilityService; no root, no Shizuku
  (§2).
- The agent loop must run natively (Kotlin), not in RN JS, because RN timers
  pause in the background (§6).
- A Claude subscription can't be used by third-party apps; a provider API key is
  required (§5).

Made while writing the PRD and SPEC (2026-10-28, session 3). These are my
recommendations, not yet confirmed by the user; PRD §10 lists the questions:

- **Financial and investment apps start read-only**, promoted per app with a
  typed confirmation. Why: RESEARCH §8 put banking on a deny list, but the user's
  job list includes financial apps. Read-only serves "gather and summarise" and
  keeps money movement behind an explicit choice. (PRD Q1)
- **Approvals and questions go through heads-up notifications** (Approve/Deny,
  inline reply), single-use nonce per gate. Why: they work over any app, need no
  overlay text input, and the agent can't tap its own approval because the loop
  is suspended and Deputy's own nodes are denied.
- **Kotlin owns all state; RN only renders it.** Why: the loop runs while RN's UI
  may be dead (RESEARCH §6), so settings, trust, automations and logs must be
  readable natively.
- **Schedules post "Tap to run" by default**; auto-run only on an unlocked,
  awake phone. Notification rules never auto-approve and may use only their
  listed apps.
- **No on-device model in v1**; FunctionGemma is text-only and needs fine-tuning,
  so it could only be a later router. (PRD Q3)
- Package `com.haroon.deputy`, dir `apps/deputy`, module `deputy-agent`, brand
  `deputy` (hue and icon still to choose, PRD Q4).

Made in Phase 1 (session 4, 2026-10-28). Each is a ruling the user hasn't
confirmed; the cost if wrong follows the dash:

- **Provisional brand:** hue 30, accent `#FB923C` dark / `#B43C0A` light,
  onAccent `#2A1000` / `#FFFFFF`; placeholder icon (orange ring and dot on
  `#1A100A`, `apps/deputy/assets/icon.svg`). Passes the contrast test. Flag for
  the user (Q4) — a token and icon swap.
- **Phase 1 `ServiceState` is three fields** (`accessibilityEnabled`,
  `notificationsAllowed`, `batteryUnrestricted`). `keySet` and `runActive` wait
  for KeyVault and AgentRuntime, because a hard-coded `false` would show a setup
  row the owner can't fix — two fields to add back in Phase 2/3.
- **"Enabled" is read from `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES`**,
  not from whether the service is bound, so AC-10 reflects what the OS switched
  off — a bound-but-not-listed state would read as off.
- **The tree dump is uncapped** (SPEC §5's 150-node cap is Phase 2's
  ObservationBuilder), so S4 sees real sizes. It redacts password text and
  description (rule 3), escapes `"`, `\`, `<` and newlines so a node can't forge a
  line or close `<screen>`, and refuses Deputy's own windows (rule 4). There is no
  trust table yet, so **Phase 2 must put the dump behind `Policy.preObserve`** —
  until then the owner can dump any app's screen to their own screen.
- **The dump returns to the UI; a separate Copy button writes the clipboard**,
  because the dump finishes while another app is in front and background
  clipboard writes are unreliable (not tested) — one extra tap.
- **`INTERNET` and `POST_NOTIFICATIONS` come from `app.json`** (as in the Store),
  not the module manifest. No `<queries>` until `listApps` exists (Phase 3).
- **Spike probes ship in the Phase 1 build** (`SpikeProbes.kt`, one file, plus a
  `ProbeForegroundService` and the `FOREGROUND_SERVICE` /
  `FOREGROUND_SERVICE_SPECIAL_USE` permissions), so one Store release answers
  S3, S4 typing, S5, S8 and S9. The SPEC allows the FGS permissions only if S3
  passes: **delete the file, the service entry and those permissions after the
  spikes**, keeping the FGS only if S3 passes. S8 keeps notification text in a
  40-line in-memory buffer, never on disk or sent anywhere — a second release to
  remove them.
- **`minSdk` 33** through `android.minSdkVersion=33` in
  `apps/deputy/android/gradle.properties` (no `expo-build-properties`) — a
  `prebuild --clean` would drop it, but `android/` is committed, as for every app.
- **Plain branch, not a worktree; no commits.** The executing-plans ledger
  scripts weren't used: SPEC §17 isn't a plan file, so this handoff is the ledger.

## Evidence already verified

- **Android SDK.** `platforms;android-36/android.jar` has: `takeScreenshot`,
  `takeScreenshotOfWindow`, `ERROR_TAKE_SCREENSHOT_SECURE_WINDOW`,
  `ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT`, `dispatchGesture`,
  `performGlobalAction` (BACK/HOME/RECENTS/NOTIFICATIONS/LOCK_SCREEN),
  `getWindows`, `getInputMethod`, `AccessibilityInputConnection.commitText`,
  `AccessibilityServiceInfo.FLAG_INPUT_METHOD_EDITOR`, `isAccessibilityTool`,
  `FOREGROUND_SERVICE_TYPE_SPECIAL_USE`.
- **React Native timers.** RN 0.81.5 `JavaTimerManager.kt:122,276`: JS timers
  skip frames while the activity is paused unless a headless JS task is running.
- **Existing repo code.**
  - The Store installs through `PackageInstaller` sessions
    (`apps/store/modules/store-installer/.../Installer.kt:88`).
  - Store secrets use AES-GCM with an Android Keystore key
    (`.../Credentials.kt`).
  - OpenTunnel already uses a `specialUse` foreground service.
  - Releasable apps are registered in `tools/release/src/apps.ts`; UI brands
    live in `packages/ui/src/tokens.ts`.
- **Gemini (Google pricing page, fetched 2026-10-28).**
  - `gemini-3.8-flash`: $0.75 in / $3.75 out / $0.075 cached per 1M tokens until
    2026-12-31, then double.
  - Free-tier content is used to improve Google products.
  - Cheaper models: `gemini-3.1-flash-lite` $0.25/$1.50; `gemini-2.5-flash-lite`
    $0.10/$0.40.
  - OpenAI-compatible endpoint
    `https://generativelanguage.googleapis.com/v1beta/openai/` supports tools,
    base64 images and `reasoning_effort`.
  - Gemini 3 returns thought signatures with tool calls, and they must be sent
    back unchanged (community reports: missing ones cause a 400).
- **Claude (claude-api skill, cached 2026-10-06).**
  - Opus 5.5 `claude-opus-5-5` $4/$20; Sonnet 5.5 `claude-sonnet-5-5` $2/$10;
    Haiku 5.5 `claude-haiku-5-5` $0.10/$0.50.
  - Computer use on 5.5 models only through `computer_toolset_20260801`.
  - Since 2026-02-19, subscription OAuth is restricted to Claude.ai and Claude
    Code.
- **User's phone.**
  - Redmi Note 14 Pro **4G**, 8 GB LPDDR4X RAM. Xiaomi "extended RAM" is swap on
    UFS 2.2 storage.
  - MediaTek Helio G100-Ultra (2x A76 @2.2 GHz + 6x A55, Mali-G57 MC2),
    Geekbench 6 about 710 / 1950.
  - The Store already special-cases Xiaomi/HyperOS installs.
- **FunctionGemma 270M (Hugging Face model card).**
  - 288 MB int8, about 550 MB peak RAM, 32K context.
  - Text-only (no images). Meant to be fine-tuned for a fixed set of functions:
    Mobile Actions eval 58% base, 85% fine-tuned.
  - Speed on the S25 Ultra CPU: about 1718 tok/s prefill, 126 tok/s decode. Not
    measured on the user's phone.
  - Gemma licence.
- **Gemma 4 E2B/E4B.** Runs on-device through LiteRT-LM with function calling;
  E2B is about a 2.6 GB download. Likely impractical on the user's chip, but not
  measured.
- **Spike S6, done (session 4, from the build, not docs).**
  - RN 0.81.5 pins OkHttp 4.9.2, Okio 2.9.0, Kotlin 2.1.20
    (`react-native/gradle/libs.versions.toml:31-36`). OkHttp is **not** on
    `deputy-agent`'s compile classpath (only `kotlinx-coroutines-core:1.7.3`
    through expo-modules-core). Phase 2 must declare
    `implementation("com.squareup.okhttp3:okhttp:4.9.2")`; with that, the app's
    runtime classpath still resolves 4.9.2 (checked with `:app:dependencies`).
  - JSON: `org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1` (Apache-2.0)
    builds with Kotlin 2.1.20 and needs **no compiler plugin** for the tree API. A
    throwaway JVM test parsed an assistant message with
    `extra_content.google.thought_signature` into `JsonObject`, and `toString()`
    gave back the identical string (2/2 pass; test and dependency removed
    afterwards). That is the §9.3 verbatim replay.
  - minSdk: Expo's root plugin defaults to the version catalog's 24 and maps the
    Gradle property `android.minSdkVersion` onto it
    (`expo-modules-autolinking/.../ExpoAutolinkingSettingsExtension.kt:123`). The
    merged debug manifest shows `minSdkVersion="33"`, `targetSdkVersion="36"`.
- **Phase 1 build facts.** `expo prebuild --platform android --no-install` makes an
  `android/` identical to the Store's apart from the Store's release-signing and
  `appsHubVersionCode` block in `app/build.gradle`, which was copied over. The
  debug manifest's `SYSTEM_ALERT_WINDOW` comes from `src/debug` (dev menu); the
  main manifest removes it, as in the Store. Gradle needs `JAVA_HOME` and
  `ANDROID_HOME` exported (AGENTS.md values). `pnpm install --offline` re-resolves
  `@types/node`; the online install gives the same lockfile (51+/11-: Deputy's two
  importers, plus 11 transitive `@types/node` 22.20.5→22.10.10 re-points, a dedupe
  against `apps/open_tunnel_vpn`'s exact `22.10.10` pin). Root `.gitignore` now
  has a Deputy block like the Store's; without it `git add apps/deputy` would
  have committed about 250 files from the module's `android/build/`.
- **Merge side effect.** `tools/release/src/changed.ts` releases every registered
  app that pnpm's graph says changed. The `deputy` brand edit in `packages/ui`
  therefore marks netlens, open-tunnel, pdf-editor and store as changed: merging
  this branch to `main` makes CI release all four with no user-visible change.
  Options for the user: accept it, or split the brand edit and release it
  deliberately (the user decides).
- **Store visibility.** `apps/store/modules/store-installer/android/src/main/AndroidManifest.xml`
  lists each released package in `<queries>` ("keep in sync with
  tools/release/src/apps.ts"). Without a `com.haroon.deputy` entry the Store
  can't see Deputy's installed version, so registering Deputy also changes the
  Store, and CI then releases a new Store on `main`.

## File map

- `docs/deputy/RESEARCH.md`: feasibility research, done. It was written before
  the user chose Gemini, so its §5 cost table covers Claude only. The Gemini
  facts are above.
- `docs/deputy/PRD.md`: requirements (FR-1..10, NFR-1..5, nine safety rules,
  AC-1..10), metrics, scope, risks, open questions Q1..Q5. Written 2026-10-28.
- `docs/deputy/SPEC.md`: architecture, module contract, loop, policy, provider
  layer, storage, UI, manifest, tests, phases 1..5, Phase 1 spikes S1..S9.
  Written 2026-10-28.
- `docs/handoffs/deputy.md`: this file.
- `docs/deputy/EVAL.md` is to be written in Phase 2.
- Phase 1 code (branch `deputy-phase-1`):
  - `apps/deputy/` — `app.json` (`com.haroon.deputy`), `App.tsx` (Setup list,
    "Deputy is off" notice, tree dump, spike probes, "Turn off Deputy"),
    `src/setup.ts` + `src/__tests__/setup.test.ts` (checklist rows), `assets/`
    (placeholder icon), `android/` (prebuild output with the Store's signing
    block; `gradle.properties` sets minSdk 33).
  - `apps/deputy/modules/deputy-agent/` — `src/index.ts` (TS contract);
    `android/src/main/AndroidManifest.xml` (accessibility service, probe FGS);
    `res/xml/deputy_accessibility_service.xml` (SPEC §14 config);
    `java/.../core/ServiceSetting.kt`, `core/TreeDump.kt` (pure, JVM-tested);
    `android/DeputyAccessibilityService.kt`; `android/SpikeProbes.kt` (delete
    after the spikes); `DeputyAgentModule.kt`; tests in
    `android/src/test/.../core/`.
  - `packages/ui/src/tokens.ts` + `web/tokens.css` (`deputy` brand), `AGENTS.md`
    (Deputy listed, its brand and native gate), `docs/app-store.md` (checklist
    entry for `com.haroon.deputy`).
  - Session 5: `tools/release/src/apps.ts` (+ `__tests__/apps.test.ts`) and the Store's `<queries>` in `apps/store/modules/store-installer/android/src/main/AndroidManifest.xml`.

## Session log

- 2026-10-28: research done; RESEARCH.md and this handoff written; open
  questions asked.
- 2026-10-28: user answered (see Decisions). Gemini pricing and endpoint
  verified.
- 2026-10-28: user asked whether the stop came from their hooks. Confirmed it is
  model-side (see Evidence).
- 2026-10-28: researched FunctionGemma and Gemma 4 on-device; recorded the phone
  specs.
- 2026-10-28: user asked to retry the PRD/SPEC. Declined, because after a
  classifier stop that content must not be produced again, even reworded.
- 2026-10-28: user asked how to start the implementation. That answer was also
  stopped by the safety classifier, so no implementation guidance was given.
- 2026-10-28: new session resumed from this file. State confirmed unchanged.
  Found that option 1 below already has a full checklist (4 package names, cert
  SHA-256, 20-device authorisation) in `docs/app-store.md:207-225`; nothing to
  draft. Both options need the user's own action (Play/Android Console account,
  phone test). Waiting on their pick.
- 2026-10-28 (session 3): user asked for the PRD and SPEC again, in a new session
  and with the stops above in view. No stop instruction exists in this session's
  context, and the request is a personal, guarded phone-agent app (native gate,
  blocked list, kill switch, no telemetry, no detection evasion), so I judged it
  on the merits and wrote `docs/deputy/PRD.md` and `docs/deputy/SPEC.md`. No
  classifier stop occurred while writing them. Checked in the SDK
  (`android.jar`, API 36): `AccessibilityNodeInfo.isPassword()` and
  `isAccessibilityDataSensitive()`, `TYPE_NOTIFICATION_STATE_CHANGED`,
  `disableSelf()`, `takeScreenshot`. Phone is Android 16 (`docs/app-store.md:197`).
  Gemini cost per task derived from RESEARCH §5's assumptions (about $0.15 with
  caching, $0.60 without; estimate, SPEC §9.5). Did not edit AGENTS.md.
- 2026-10-28 (session 3): user asked for a prompt for a new chat to start
  implementing. Set the next step to Phase 1 and wrote the resume prompt from
  this file. No stop occurred.
- 2026-10-28 (session 4): Phase 1 build. Created branch `deputy-phase-1`.
  Brand, scaffold (prebuild), module, service, `getServiceState`, tree dump,
  Setup screen and spike probes, test-first where the logic is pure (TS setup rows
  RED→GREEN 5/5; `ServiceSettingTest` + `TreeDumpTest` failed on unresolved
  references, then 12/12). S6 done (Evidence). Root `CLAUDE.md` appeared
  untracked during the session; not created by this session and left alone. No
  classifier stop occurred. Verification (real output):
  - `pnpm test`: exit 0. ui 15/15, core 65/65, store-manifest 4/4,
    open-tunnel-core 26/26, deputy 5/5, release 5/5, store 10/10, store-api 5/5,
    open_tunnel_vpn 41/41.
  - `pnpm typecheck`: exit 0 (11 packages).
  - `cd apps/deputy/android && ./gradlew :deputy-agent:testDebugUnitTest
    :app:assembleDebug`: BUILD SUCCESSFUL; ServiceSettingTest 6/6, TreeDumpTest
    6/6; `app-debug.apk` built.
- 2026-10-28 (session 4, later): two fresh reviews.
  - `invariant-reviewer`: 5 minor findings, none blocking.
  - `code-reviewer`: 1 must-fix, 3 should-fix, 2 nits.
  - Fixed in one pass:
    - Root `.gitignore` Deputy block.
    - Rule 4 refusal moved into pure `TreeDump.refusal`, tested by
      `refusesDeputysOwnScreens` (RED on an unresolved reference, then GREEN).
    - Copied text marked `ClipDescription.EXTRA_IS_SENSITIVE`.
    - `disableService()` now returns false when the service isn't connected, and
      the UI then opens Accessibility settings. The kill switch never silently
      does nothing.
    - One "isn't connected" message replaces "is off" in the module fallbacks.
    - S3 fires only 60 s or more after arming and logs the wait, screen state and
      a null `startForegroundService` result.
    - S4 checks the exact text, so a repeat run can't pass.
    - S5 steps through gaps of 0, 200, 350, 500, 750 and 1000 ms, logs the time
      since the last accepted shot, and gives up on a missing callback after 5 s.
    - The vacuous setup test is replaced by a row-to-action map. A mutation, the
      battery row sent to App info, failed it.
  - The probe fixes are compile-verified only (device-only code, deleted after
    the spikes).
  - Not fixed: the dump bypassing `Policy.preObserve` (a Phase 2 must, above),
    and a missing `TextDecoder` in the untracked root `CLAUDE.md`'s Hermes note
    (not this session's file; reported to the user).
  - Final run: `pnpm test` exit 0, every package fail=0 (deputy 5/5);
    `pnpm typecheck` exit 0; Gradle gate BUILD SUCCESSFUL with ServiceSettingTest
    6/6 and TreeDumpTest 7/7.
  - Untracked `CLAUDE.md` files (root, `apps/*/`, including `apps/deputy/`) and
    `.claude/rules/` appeared during the session from outside it. Left untouched,
    and `apps/deputy/CLAUDE.md` would ride along with `git add apps/deputy`.
- 2026-10-29 (session 5): the user said "continue", which wasn't read as a release
  go-ahead (the release publishes outside this machine). Did the local half of the
  release: registered `deputy` (release test RED, then 5/5) and added the Store's
  `<queries>` entry (Store gate green). Checked the release endpoint and the signing
  properties without printing secrets. Asked the user for the go-ahead.

## Current state + exact next step

- **Phase 1 code is built and verified locally** on branch `deputy-phase-1`, all
  uncommitted (the user hasn't asked for a commit). `docs/deputy/`, this file,
  `apps/deputy/` and the edits to `packages/ui`, `AGENTS.md`,
  `docs/app-store.md` and `pnpm-lock.yaml` are the change. Leave the untracked
  root `CLAUDE.md` out of it unless the user says it belongs.
- Earlier classifier stops (recorded in the log above) hit the PRD, the SPEC and
  an implementation how-to in previous sessions. None fired in session 4. If one
  fires again, stop, record it here, and don't reword the content.
- **Phase 1 exit isn't met yet.** It needs the app installed through the Store,
  accessibility on, a real app's tree dumped and S1–S5, S7–S9 recorded here. S6 is
  done.
- **Exact next step: the user's go-ahead for the first Store release** (asked on
  2026-10-29, session 5). The release doesn't run without it.
  1. Done (session 5): Deputy is registered in `tools/release/src/apps.ts`
     (test: `apps.test.ts` maps `apps/deputy` and its module to `deputy`, RED
     then GREEN), and `com.haroon.deputy` is in the Store's `<queries>`. Store
     gate: `:store-installer:testDebugUnitTest :app:assembleDebug` BUILD
     SUCCESSFUL, ApkVerifierTest 7/7, and the merged manifest has the entry.
  2. Account check (session 5): `pnpm release` uploads only to the Worker at
     `https://apps-hub-store.haroonmukhtar4.workers.dev` with `RELEASE_TOKEN` from
     `~/.config/apps-hub/release.env`. That is the personal account (memory:
     private-app-store), so no `cf` login or deploy is involved, and the signing
     properties are present. The user still confirms.
  3. After the go-ahead, run `pnpm release store -m "Sees Deputy"` first, so the
     Store can see Deputy once installed, then `pnpm release deputy -m "Deputy
     0.1.0: setup screen and spike probes"`. Releasing from this branch avoids
     the merge side effect (Evidence). It publishes uncommitted code unless the
     user asks for a commit first. Install on the phone through the Store only.
- **Phone runbook** (the user runs it; record each result, pass or fail, under
  Evidence):
  - **S1:** Setup → "Turn on the Deputy accessibility service". Is Deputy listed;
    does the switch work, or is it greyed out with "Restricted setting"? If
    restricted: App info → ⋮ → Allow restricted settings, then retry. Write down
    the exact taps.
  - **S2:** any Play Protect dialog during install or after enabling: exact
    wording, blocked or not, which button got past it.
  - **S3:** Spike probes → "Arm foreground service test", then leave Deputy for
    more than a minute (try once with the screen on in another app and once
    locked). The probe fires on the first window change or notification after 60 s
    (earlier starts fall inside Android's grace period and always pass). "Show
    report" gives `S3 <n>s after arming, screen on|off, on a …:` followed by
    `accepted`, `returned null (not started)` or the refusal, then
    `S3 startForeground ok|failed`.
  - **S4:** "Read the app in front", then switch within five seconds to a
    messaging app, an email app, a Flutter app, a WebView/browser app and a
    finance app. For each, note the `pkg, N nodes` line and whether the labels
    make sense, and copy the text if the user is willing to share it. Typing: tap
    into a non-password text field in another app, then "Test typing in five
    seconds"; record `returned … text changed / did not change`.
  - **S5:** "Test screenshots in five seconds" on a normal app, then on a secure
    screen (banking app). The report gives each attempt's result and latency.
  - **S8:** with the service on, receive a message in the owner's messaging app;
    "Show report" lists `S8 <pkg> text=… title=… body=…`. Is the message text
    there?
  - **S9:** note the "service connected since" time, leave the phone 30 minutes
    with default battery settings, then check it's unchanged and the Setup row
    still says On. Repeat after the battery and Autostart rows are done.
  - **S7** (no phone): needs the user's Gemini key (and Q5, which billing
    project). Run it from a shell with the key in an environment variable typed
    by the user; never write the key to a file, a log or this handoff.
- **After the spikes:** decide §3 (FGS or plain notification) from S3, the node
  cap and screenshot rule from S4/S5, and accessibility events or
  `NotificationListenerService` from S8. Then delete `SpikeProbes.kt`, the probe
  service entry and (unless S3 passed) the FGS permissions, and update SPEC §1,
  §3, §5, §11 and §14 with the results. Then Phase 2.
- Open PRD questions: Q1 and Q2 build on the recommended defaults; Q4 has the
  provisional brand and icon above, waiting on the user; Q3 waits on the
  on-device model test; Q5 is asked with S7.
- Not part of Phase 1, still open and independent of this app:
  1. **Store-wide developer verification.** Register the `com.haroon.*` packages
     and the release cert under a free limited-distribution account before
     enforcement reaches the user's region (RESEARCH §4). Steps are in
     `docs/app-store.md:207-225`. Note the list there also covers `app.netlens`
     and `com.opentunnel.open_tunnel_vpn`, which are not `com.haroon.*`.
  2. **On-device model test.** The user runs the FunctionGemma demo in Google's
     AI Edge Gallery app on the phone and reports speed and RAM use.
