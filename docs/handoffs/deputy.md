# Handoff: Deputy (on-phone AI agent for Android)

## Resume prompt

Dated 2026-10-29. Read `docs/handoffs/deputy.md` completely first, then
`docs/deputy/PRD.md`, `docs/deputy/SPEC.md` and `docs/deputy/EVAL.md` (open
`docs/deputy/RESEARCH.md` only where this file cites it). Trust the verified facts
and the Phase 2 and Phase 3 work below, and don't redo them (Phase 3 is built on
branch `deputy-phase-3`, JVM 167/167). Follow the handoff contract in
`~/.claude/CLAUDE.md`. Read "Current state + exact next step" before doing
anything, including the safety-classifier rule there, then continue from it. Commit
or release only when the user says so.

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

Made in Phase 2 (session 6, 2026-10-29). Rulings the user hasn't confirmed unless
marked; **(prov.)** means it waits on a spike:

- **Dependencies, approved by the user:** `okhttp:4.9.2` and
  `kotlinx-serialization-json:1.8.1` (implementation), `kotlinx-coroutines-test:1.7.3`
  (tests only, virtual time). All Apache-2.0; `:app` still resolves OkHttp 4.9.2.
- **One node type.** `DumpNode` is gone; `NodeRef` (`core/Action.kt`) carries
  `pkg`, `bounds`, `visible`, `depth` and `childText`, and the debug dump uses it.
- **Policy details beyond SPEC §8.2:**
  - `type_text` with Enter is confirmed in standard apps, because Enter can send.
  - Tap, long-press or type with no node behind the index is denied.
  - `open_link` is denied when the run has `allowedApps`, since the app a link
    opens can't be known.
  - `press`, `wait` and `look` have no package, so rules 1–3 skip them, and a run
    can't get trapped.
  - Rule 1's "settings that change Deputy" means a Settings package
    (`com.android.settings`, `com.miui.securitycenter`) whose title says
    accessibility or special access, or that shows Deputy's name. Sensitive flows
    are the permission controller and Settings pages titled security, privacy,
    lock and similar. **(prov.)** These lists come from AOSP and HyperOS names
    known so far; extend them from S4 dumps.
- **Default trust (FR-4)** is `core/DefaultTrust.kt`: blocked means Deputy, the
  Store, three package installers and 15 password or authenticator apps.
  Read-only means a package-name word (bank, wallet, pay, invest, broker,
  trading, finance, crypto) or a short list (Revolut, Wise, Robinhood, eToro,
  Binance, Coinbase, Google Pay India). A bank it misses is standard until
  Phase 3's Apps screen, so its money steps are confirmed but not denied.
- **Observation:** a cap of 150 nodes and 8,000 characters **(prov., S4)**, keeping
  the nodes nearest the centre. Child labels are lifted onto unlabelled clickable
  rows (S4 finding), and the children used are left out. Nodes from blocked
  windows or Deputy's own are dropped one by one, which also hides the Stop chip.
  Password text is stripped from the index map as well as the text.
- **Open risk:** the notification shade's nodes all belong to `com.android.systemui`,
  so a blocked app's notification (an OTP, say) in an open shade isn't filtered.
  Decide on the Android side, for example by refusing to observe while the shade
  is open unless the task asked for it.
- **Gates:** one pending at a time. Opening a new one cancels a leaked old one. A
  question's answer never counts as approval, even if the receiver says approve.
- **Prices** default to Gemini Flash's and double from 2027-01-01 UTC
  (`Prices.geminiFlash`), so the cost cap doesn't under-count in January.
- **Provider:** `OpenAiCompatProvider` sits in `core/` and takes a `post` function,
  so the OkHttp transport on the Android side is only the HTTP call plus cancel.
  `tool_choice` is sent only with tools. Unreadable `arguments` become `{}`, which
  makes the tool parse report the missing field to the model.
- **Loop:** each observation goes in a user message (plus the image), and each
  tool result in a tool message. Screenshots go on the first step, after `look`,
  when fewer than 5 nodes are labelled, or after two unchanged screens. `tap_at`
  coordinates are in 720-px-wide screenshot pixels (`AgentLoop.SHOT_WIDTH`), so
  the Android screenshot must downscale to exactly 720 wide. A question's timeout
  ends as `failed`, a confirm's timeout as `declined`. History is never
  summarised (shortcut in the code).

Made in Phase 2, Android side (session 7, 2026-10-29). Rulings the user hasn't
confirmed; **(phone)** means unverified until the eval:

- **The shade is never read (decides the open risk above).** `read()` takes the
  active window and other application windows only; System UI's (status bar,
  heads-up, shade) are skipped, and when System UI is in front the observation
  has no nodes and says "not read" (`ObservationBuilder`, tested). Screenshots
  are skipped for 10 s after a blocked app posts a notification, since its
  heads-up can sit over any screen. Notification jobs come through Phase 4's
  rules, which know the sending package.
- **Flutter typing fails clearly; IME stays Phase 5.** When the text doesn't
  change after `ACTION_SET_TEXT`, the tool says typing isn't possible here.
  Turning on `flagInputMethodEditor` would change the service's config and its
  consent sheet without a phone test.
- **Secure windows (phone):** a frame whose app-window area samples (12x12) all
  near-black is dropped, and the model is told a screenshot is missing. Any
  capture failure retries once after 350 ms.
- **`resolveLink`** returns null only for the system chooser (`android`).
  Browsers aren't special-cased: a browser handler is a standard app, so it
  changes no verdict.
- **Settle** counts 400 ms of quiet from the action itself (so it never returns
  before the action's events), with a 3 s cap. Deputy's own events and
  notification events don't count.
- **Runs start by pressing Home**, because Deputy's own screen is blocked and the
  loop would otherwise spend its first step pressing Back on itself.
- **Fixed endpoint and model** (Gemini compatible endpoint, `gemini-3.8-flash`,
  no `reasoning_effort`) until Phase 3's Settings (shortcut in `AgentRuntime`).
- **Default model is `gemini-3.5-flash-lite` (user's choice, session 7, after
  S7).** `Settings.GEMINI_MODEL` and `Prices.geminiFlashLite` ($0.30 / $0.03 /
  $2.50, Google's pricing page 2026-10-29, no dated change). Flash's dated prices
  and their test are gone; 3.8 Flash now needs its prices entered in Settings.
- **Run button** needs the service on, notifications allowed (the gate's
  heads-up), a key, and no run active (`canRun`, tested). Battery stays advice,
  per S9.
- **The Run screen rebuilds from `getRun()`**, the in-memory events of the
  current or last run. Reading old runs from the log is Phase 3's history.
- **A question gate has no Deny**; an ignored question times out as `failed`.
- **Gate notifications are text only** (SPEC §8.3 allows it); the icon is a
  system drawable until Q4 (shortcut).
- **Stop chip colours** come from `setPalette` (the whole `@apps-hub/ui`
  palette); before RN pushes one, it falls back to platform grey and black.
- **Spike probes deleted** (`SpikeProbes.kt`, the probe service and their UI);
  the FGS permissions stay for `RunService`.

Made in Phase 3 (session 8, 2026-10-29). The user chose to build Phase 3 before
the Phase 2 phone eval, on a new branch `deputy-phase-3` cut from `c705a73`. Rulings
the user hasn't confirmed:

- **Trust overrides** live in their own prefs file `deputy-trust` (package →
  level), not a JSON document; setting an app back to its default deletes the
  override. Deputy's own package is blocked in `TrustTable.level` whatever is
  stored, and `set` refuses it. The run's Policy, the debug dump and the
  blocked-notification screenshot check all read `OwnerStore.trust`; nothing reads
  `DefaultTrust` alone any more.
- **Money-app promotion:** the typed text must equal the launcher label, ignoring
  case and surrounding spaces (SPEC said "equals"; case-insensitive is friendlier
  and just as deliberate). The label comes from `PackageManager`, never JS. Only
  apps that are read-only *by default* need it; a bank the defaults miss, set
  read-only by hand, goes back to standard without typing.
- **Settings** (`core/Settings.kt`) are one flat object over the bridge and in
  prefs. Ranges: https only; one-word model; prices 0–1000; steps 1–100; $0.01–20
  per task; 1–60 minutes; $0.01–100 per day. Prices are stored only after the
  owner edits one (`customPrices`), so January's Gemini doubling still applies by
  default. **Changing the base URL deletes the saved key**, so a Gemini key is never
  sent to another host. http is refused even for a LAN server (Android blocks
  cleartext anyway). After review: **the key is also bound to its address**
  (`KeyVault` stores the URL; `load`/`has` take the settings), so a settings
  fallback to Gemini can't send another provider's key to Google; **any model or
  address other than the Gemini default needs its own prices**, and input and
  output prices must be above 0, so the cost caps can't undercount or switch off;
  steps and minutes must be whole.
- **Clear history carries today's spend** in `filesDir/deputy/spent`, so it can't
  reset the daily cap (tested; a mutation removing the carry fails the test). The
  carry is written before deleting, and retention (the 200-run cap) uses the same
  path, which closes a daily-cap gap Phase 4's notification rules could reach.
- **Trust is live within a run:** `OwnerStore` caches the table in memory and
  replaces it on each change; the run's Policy reads it per call, so blocking an
  app mid-run applies from the next step. Not JVM-testable (Android wiring); EVAL
  has an "FR-4 mid-run" row.
- **Run-finished refresh lives in `Home`**, so a run that ends while the Apps or
  Settings tab is open still re-enables Run.
- **Not built (shortcut):** FR-8's "keep screens" switch (screens are never saved,
  which is the default) and editable retention (PRD fixes 30 days / 200 runs).
- **UI:** three tabs, Tasks (run panel, saved tasks, history), Apps, Settings
  (Setup checklist, key, model, prices, limits, debug dump, Turn off). The app
  opens on Settings until setup is complete. A saved task runs from its row's Run
  button; tapping the row edits it. History shows the newest 50 and opens a past
  run's steps in a sheet. Writes return error copy instead of throwing (same as
  `startRun`).
- `listApps` and `setAppTrust` are async (they query PackageManager); the rest are
  sync.

### Speed work (session 9, 2026-10-30, branch `deputy-speed`)

The owner said "go ahead and implement it" for this order: 1 speed core, 2 direct
phone tools, 3 memory + several actions per reply. Part 4 (Jev, on-phone OCR) is
not to be built unless asked. My calls, not confirmed by the owner:

- **Known models live in `core/Settings.kt`** (Gemini 3.5 Flash-Lite; Groq
  `openai/gpt-oss-120b` and `-20b`, text only, `reasoning_effort` "low", prices
  from Groq's model cards). Known models need no typed prices; the screen gets
  their list from `knownModels()`. One key at a time stays (a new address still
  deletes it).
- **Replay keeps only `role`, `content`, `tool_calls`, `reasoning_details`** of
  the assistant message: Groq rejects unknown fields, Gemini's signature is inside
  `tool_calls`, OpenRouter needs `reasoning_details`.
- **History:** only the latest screen goes in full; older ones shrink to their
  header line and lose their screenshot. Action tools gain an optional `memo`
  argument so facts from a left screen survive.
- **429:** wait `retry-after` (capped at 60 s) instead of 1/2/4 s. Groq's
  400 `tool_use_failed` is retried.
- **Gates:** the model's `irreversible` flag is ignored for press, wait, look,
  open_app and open_settings; "clear" gates only when another word follows; type +
  Enter isn't confirmed in a field whose hint, id or description has a word
  starting with "search", unless the text has `. / : @` or 5+ digits (after
  review; session log).
- **Timing:** each step logs `modelMs` and `actMs`.
- Dropped: skipping the first screenshot (small gain once history is trimmed,
  breaks several tests).
- **Part 2 tools:** `phone_info`, `open_settings(page)`, `set_alarm`,
  `set_timer`, `find_contact` (READ_CONTACTS, optional Setup row; the permission
  is the owner's consent, no trust check), `open_chat(whatsapp|sms)` built as a
  link (`whatsapp://send`, `smsto:`) so Send stays a gated tap.
- **Part 3:** route memory reads past `done` runs from `RunStore` (no new
  storage; clearing history clears it), matched by shared words, shown as
  `<memory>` data. Extra tool calls in one reply run only if they target the same
  screen and their element is unchanged on a fresh read; any gate, denial or
  change stops the rest.

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
- **Phone spike results (session 5, 2026-10-29, over wireless debugging; adb
  only for screenshots, UI dumps and taps; no adb installs or grants).**
  - Phone: Android 16, HyperOS `OS3.0`, model 24116RACCG.
  - **Install path.** The user installed Deputy 2 from Store 8 at 00:24
    (installer of record `com.haroon.store`). Store 8 still listed Deputy as "Not
    installed", which is the missing `<queries>` entry. After updating to Store 9
    it shows "Installed 0.1.0 (2)": the fix works on the phone.
  - **S2 (Store 9 update, observed).** The steps were:
    1. PackageInstaller: "Do you want to update this app?" → Update.
    2. Play Protect: "App scan recommended. Play Protect hasn't seen this app
       before" → Scan app.
    3. Xiaomi `ScanActivity`: "Passed security tests / No risks detected" (with
       ads; don't tap them).
    Deputy's own install dialogs weren't observed (the user installed it before
    this session); no block was reported.
  - **S1 (in progress).** The taps were:
    1. Deputy Setup → "Turn on the Deputy accessibility service".
    2. Accessibility (General tab), scroll to the bottom → Downloaded apps.
    3. Deputy (Off).
    4. The "Use Deputy" switch.
    **No "Restricted setting" block** for this Store session install on Android
    16: the switch worked, so "Allow restricted settings" wasn't needed.
    HyperOS then shows a Security center "Danger" sheet listing "read all screen
    content and control screen", "learn your behaviour and automate actions"
    and **"Unlimited autostart"** (relevant to S9). It needs the box "I'm aware
    of the possible risks…" ticked and an OK that unlocks after 5 s. The user
    chose to tick it themselves.
  - **S1 result.** The user ticked the risk box and pressed OK. The service is
    enabled (`ENABLED_ACCESSIBILITY_SERVICES` holds the full component name) and
    bound, with capabilities 161 (window content + gestures + screenshots) and
    exactly the configured event types. Deputy's row turned On and the "Deputy is
    off" notice went away (AC-10 path). Connected at 00:43:20, which is S9's
    start.
  - **S4: trees are readable in every app type tried; Flutter typing fails.**
    WhatsApp, Gmail and NayaPay were dumped structure-only on the user's
    instruction: counts printed, no text, raw dump deleted.

    | App (kind) | nodes | shown | clickable | clickable without own label | other |
    | --- | --- | --- | --- | --- | --- |
    | Settings (native) | 49 | 31 | 12 | most; label in child `android:id/title` | 20 with id |
    | CamScanner (native first screen; ships Flutter) | 178 | 69 | 32 | 31 | 51 with id |
    | WhatsApp (messaging) | 130 | 69 | 35 | 15 (id only) | 32 with desc |
    | Gmail (email) | 41 | 30 | 13 | 0 | 1 editable |
    | NayaPay (finance, first screen) | 52 | 36 | 20 | 11 (id only) | 1 editable; **no accessibility warning or refusal** |
    | ReVanced Manager (Flutter) | 96 | 46 | 13 | 13 | no view ids, 27 text nodes |
    | PDF Editor (Expo WebView) | 7 | 5 | 1 | 0 | web UI barely in the tree |

    - **Node cap:** the most shown was 69 lines, so SPEC §5's 150-node cap holds.
    - **Phase 2 must lift labels:** give each clickable its descendants' (and, for
      Flutter, adjacent semantics) text in `ObservationBuilder`, and match verbs
      and the read-only "labelled" test on that lifted label. Without it,
      read-only denies most taps in NayaPay, and the verb gate misses Flutter
      buttons.
    - **WebView:** the near-empty tree triggers the screenshot rule (fewer than 5
      labelled nodes) as designed.
    - **Typing:** `ACTION_SET_TEXT` works in native fields (Settings search:
      returned true, text changed). In a Flutter `EditText` it **returned false
      and the text didn't change**. Bring the IME path
      (`FLAG_INPUT_METHOD_EDITOR` + `getInputMethod().currentInputConnection.commitText`)
      forward from Phase 5 to Phase 2, or have Flutter typing fail with a clear
      "can't type in this app" result.
  - **S5.**
    - Full-resolution 1080x2400 shots take 23–49 ms.
    - The interval limit is between 251 ms (fails fast, "interval too short", in
      5 ms) and 529 ms (ok), consistent with AOSP's 333 ms. SPEC §5's "wait 1 s
      and retry" can become about 350 ms.
    - **Secure window:** a Chrome incognito tab (window flag `SECURE` confirmed)
      returned **ok 1080x2400, not `ERROR_TAKE_SCREENSHOT_SECURE_WINDOW`**, with
      the same interval. The display screenshot succeeds and the secure layer is
      presumably blacked out (not verified; the probe keeps no image).
      **SPEC §5 must change:** detect a blank frame, or use
      `takeScreenshotOfWindow` (API 34), which reports secure windows, so the
      model is never sent a black image as if it were the screen.
  - **S3: PASS, so keep the `specialUse` foreground service (SPEC §3) and its two
    permissions.**
    - Screen on: armed 00:47:54, Deputy in the background, fired 75 s later on a
      window change: `startForegroundService accepted` and `startForeground ok`.
    - Screen off and phone locked: armed 00:50:03, fired 78 s later on an
      `adb shell cmd notification post`. The FGS notification was posted and then
      removed at the 10 s `stopSelf` (logcat).
    - Logcat for both: `Background started FGS: Allowed … code:ACTIVITY_STARTER
      allowWiu:52`, with uidState `BFGS` (screen on) and `IMPF` (locked). The
      exemption comes from the system-bound accessibility service, which grants
      the background-activity-start privilege; it isn't the fg-to-bg grace
      period.
  - **Service rebind seen.** `onServiceConnected` fired again at 00:49:16, 6 s after
    the FGS started, without process death (the in-memory log survived). So
    "connected since" alone doesn't prove a kill; S9 must also check that the log
    survives, or the process start time. `instance` must stay correct across
    rebinds.
  - **S8: accessibility events are enough for notification rules, so no
    `NotificationListenerService` (SPEC §11).** Read `parcelableData`
    (`Notification`) extras, not `event.text`. Values were checked from a report
    redacted for other apps' content (only present or null shown).
    - **WhatsApp** (the owner's messaging app), 00:59:51, phone probably locked
      (keyguard drawn at 00:54:42, no unlock seen before about 01:12; not
      proven): title and body present, category `msg`. **Two events per
      message** (one with `event.text`, one with `text=[]`), so de-duplication
      (§11) is required.
    - **Gmail**: title present, `EXTRA_TEXT` and `EXTRA_BIG_TEXT` null (email
      text sits in other extras, such as text lines or subtext). Read more
      extras if email rules are wanted.
    - **Chrome**, unlocked: title and body present, `text=[]`.
    - **The adb test notification** (`cmd notification post`, phone locked):
      title and body null. The cause is unknown: lock-screen redaction or the
      shell's notification format. Retest with a real message while locked before
      relying on locked delivery.
  - **Service rebinds** without process death: `onServiceConnected` fired at
    00:43:20 (grant), 00:49:16 (6 s after the FGS started) and 01:12:25 (about
    when the user unlocked), all in PID 7464. The in-memory log survived each
    time. Phase 2: keep `onServiceConnected` idempotent (no state reset) and have
    `AgentRuntime` handle `instance` going null and coming back mid-run (wait
    briefly, then fail the run as `service_off`).
  - **S9: PASS with default battery settings** (battery row "To do"; HyperOS's
    accessibility grant includes unlimited autostart). PID 7464 stayed alive
    from 00:24:28 to at least 01:21:24 (about 57 min), including about 25 min
    locked and dozing, and the service stayed bound the whole time (rebinds
    above, no kill). The onboarding battery and autostart steps aren't needed for
    survival on this phone; keep the battery row as advice, not a blocker.
    (The background check printed "not bound" from a bad grep; a direct
    `dumpsys accessibility` showed Deputy bound.)
  - Setup-copy follow-up: the "Allow restricted settings" row may not be needed on
    this path; the Danger sheet and the Downloaded apps location belong in the
    FR-10 copy.
- **Working notes for this machine (session 4–5).**
  - Shell: zsh. A line like `echo ====` aborts the command line, and unquoted
    globs such as `--include=*.kt` fail. There is no `timeout`; use the Bash
    tool's own timeout or background runs.
  - Gradle needs `JAVA_HOME` and `ANDROID_HOME` exported; read test counts from
    `modules/deputy-agent/android/build/test-results/testDebugUnitTest/*.xml`.
  - A hook allows at most 2 comment lines per edit.
  - `pnpm test` prefixes each line with the package name, so don't anchor greps
    at `^#`.
- **Spike status, asked 2026-10-29 (session 6).** The user answered "none yet",
  but the phone results above (S1, S2, S3, S4 partial, S5, S8 partial) were
  written into this file by a parallel session while session 6 ran, so they count.
  Since then (session 5): S4 and S9 answered and S8 answered for WhatsApp; only
  S7 is open. No Gemini
  key exists yet (Q5 "not set up"), so S7 waits. Spike-dependent choices without a
  result take the SPEC default and are listed as provisional under Decisions.
- **Spike status, asked 2026-10-29 (session 7).** No new results: the user said
  "I don't know". The phone spikes are all answered above, apart from an
  optional S8 retest with a real message while the phone is locked. That retest
  moves to Phase 4, where notification rules log the events themselves. S7 is
  still open (no key yet: "Not yet, carry on").
- **S7 (session 7, 2026-10-29, from the Mac with the user's free-tier key read
  from the Keychain into curl's header; key never printed or written).**
  - `GET /v1beta/openai/models`: 200; 60 models, including `gemini-3.8-flash`,
    `gemini-3.7-flash`, `gemini-3.5-flash-lite`, `gemini-flash-latest`, and
    `gemini-flash-lite-latest`. `gemini-2.5-flash` gives 404: "no longer
    available to new users".
  - `gemini-3.8-flash`, "Reply with the word OK", one request at a time: 200 in
    74 s, then 7.4 s. With `reasoning_effort` "low" or "none", or with three
    requests in parallel: no answer within 120 s. With tools and an image:
    **503 "This model is currently experiencing high demand"** after 4 s. The
    phone's slow 503s (about 45–57 s per attempt) are this overload.
  - `gemini-3.7-flash`: 200 in 34 s.
  - **`gemini-3.5-flash-lite`: full pass.** Deputy-style tools (including
    `look`'s empty `properties`) plus a 720×1600 JPEG: 200 in 3.7 s, 1,317
    prompt tokens, and a `finish` call carrying
    `extra_content.google.thought_signature`. Turn 2, with that assistant
    message replayed verbatim plus tool results: 200 in 2.7 s. `usage` has no
    `prompt_tokens_details`, so cached tokens aren't reported on this endpoint
    (NFR-2's caching assumption is unverified). `gemini-flash-lite-latest`:
    200 in 1.3 s.
  - The key is still in the Keychain (`deputy-gemini`); delete it with
    `security delete-generic-password -s deputy-gemini` when the user says.
- **Phase 2+3 eval, Part 1 (session 7, 2026-10-29, Deputy 4 = `af1f85f`,
  `gemini-3.5-flash-lite`, free tier; tasks typed and Run tapped over adb, the
  owner answering gates on the phone).** Deputy 4 was installed through the Store
  (same four dialogs as Deputy 3); the key carried over; the service stayed bound.
  | # | Task | Result | Time, steps, cost |
  | - | ---- | ------ | ----------------- |
  | 1 | Clock: next alarm (AC-1) | **Pass**, no gate: "8:30 AM and 9:00 AM, both deactivated" (true; the system's next alarm is another app's) | 49 s, 5, $0.0070 |
  | 2 | Settings: Android version | Right answer ("Android 16, BP2A.250605.031.A3") but **3 gates on "Tap Back" in Settings** (rule unknown, see below); an `intent:` link was refused as designed | 127 s incl. gate waits, 9, $0.0056 |
  | 3 | Settings: free storage | **Pass**: "107.3GB/256GB (148.7GB free)", matches `df` | 15 s, about 2 |
  | 4 | Clock: time in London | Right ("9:07 AM", the Mac agreed) with **1 gate by design** (type + Enter); the search-result tap likely added London to the world clock | 42 s, 7 |
  | 5 | Calculator: 1234 × 5678 | **Fail**: "Tap 'clear'" gated (verb list), unanswered, expired as declined | 5 min 18 s, 3 |
  - Every step's model call took about 3–6 s on Flash-Lite (vs 503s on 3.8 Flash).
  - Two `open_app` calls hit "several apps match" (Clock, Calculator) and the
    model then used the package name: the session-7 fix works on the phone.
  - Approving inside Deputy (the owner opened the gate from its notification)
    pressed Back to Settings and carried on: the session-7 fix works.
  - Findings to fix (owner's call on the trade-offs):
    1. A gate doesn't say which rule fired, so the "Back" gates in task 2 can't
       be explained (likely the model's `irreversible` flag, or a Settings page
       title on the security list). Record the rule in the step and show it on
       the gate.
    2. The verb "clear" gates a calculator's C key. Options: match "clear" only
       with an object ("clear data", "clear chat", "clear all"…), or keep it.
    3. Type + Enter is always confirmed, which gates search boxes. Option:
       exempt fields whose hint or id says search.
    4. The gate's draft text took the calculator's display ("210×80"): only use
       a draft for sends, not for every editable field.
  - Harness notes: adb `input text` can drop the first letter after clearing a
    field; tasks went in as typed otherwise.
- **Q5 answered (session 7): the free tier.** Google may use what Deputy sends
  (screens from messaging and finance apps included) to improve its products
  (Evidence, Gemini). Setup must say so beside the key, and the PRD risk row
  "the owner uses a paid-billing key" doesn't hold.
- **Store visibility.** `apps/store/modules/store-installer/android/src/main/AndroidManifest.xml`
  lists each released package in `<queries>` ("keep in sync with
  tools/release/src/apps.ts"). Without a `com.haroon.deputy` entry the Store
  can't see Deputy's installed version, so registering Deputy also changes the
  Store, and CI then releases a new Store on `main`.
- **Speed research (session 9, 2026-10-29; owner: "Deputy is really slow").**
  Measured from the Mac with the Keychain key, a realistic step (Deputy's system
  prompt, all 13 tools, a 74-node WhatsApp chat list, 4,231 chars):
  - `gemini-3.5-flash-lite` free tier: 25–40 s per call for a 13-token `tap`
    reply, no reasoning tokens reported, so the time is queueing, not thinking.
    `reasoning_effort` "none" is a 400 on this model; "minimal" and "low" are no
    faster. 503 "high demand" on 4 of 9 calls across 3.5 Flash-Lite, the
    `flash-lite-latest` alias and 3.1 Flash-Lite (one 3.1 call: 3.1 s).
  - Prompt size grows with history: 2,648 tokens at step 1, 13,008 at step 8
    (every earlier screen is resent; `AgentLoop` never trims history).
  - Gemini's thought signature sits in `tool_calls[].extra_content.google`; the
    message itself has only `role` and `tool_calls`.
  - Groq (subagent, console.groq.com docs, fetched 2026-10-29; not live-tested):
    base `https://api.groq.com/openai/v1`. Production tool models
    `openai/gpt-oss-120b` / `-20b`, **text only**; the only self-serve vision
    model is preview `qwen/qwen3.8-27b` (max 3 images). Free tier 30 RPM, 1K RPD,
    **8K TPM**, 200K TPD; 429 carries `retry-after`; cached tokens don't count.
    gpt-oss-120b $0.15 / $0.075 cached / $0.60, about 0.7 s to first token and
    470–500 tok/s. Assistant-message schema is `additionalProperties:false`
    (role, content, name, reasoning, tool_calls), so replaying extra fields may
    400. Groq doesn't train on API data (Services Agreement §4.2), may log up to
    30 days, zero retention toggle; preview models are outside that agreement.
  - Techniques with published numbers (subagent, abstracts only for some):
    multi-action per reply (UFO2 −11 to −51% calls; "Jev-Mobile",
    arXiv 2609.30186, −32.7% time, success 84→79%), trajectory replay
    (SkillDroid, −49% calls), shortcuts (AppAgentX 106→56 s), adb/CLI agents
    10.7 vs 18.6 steps on CLI-friendly tasks (arXiv 2606.19388). Speculative
    actions conflict with the approval gate.
  - **Jev** (owner asked; web, 2026-10-29): TypeSafe AI's hosted "System One"
    decision model, `POST https://api.typesafe.ai/v1/systemone`, its own format
    (text `state` + Choice/Score questions, up to 255 options; not chat
    completions). Weights aren't public, so it can't run on the phone; it takes no
    images. About $0.042/M input, output free; median 0.2–0.33 s (third-party);
    access waitlisted; no published data policy. `dougsong/jev-android` is a
    Kotlin accessibility SDK over it (no screenshots, 220-element cap). The
    Jev-Mobile paper (VLM sets a goal, Jev picks tree candidates) typed printable
    ASCII only. A community "openjev" imitates it on a 4B open model.
  - Policy today: `https`/`http` links (so `wa.me`) are always confirmed;
    `sms:`, `tel:`, `mailto:`, `geo:` are allowed; the manifest holds no
    Contacts, SMS or call permission.

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
- Phase 2 code (branch `deputy-phase-2`, uncommitted):
  - `apps/deputy/modules/deputy-agent/android/src/main/java/expo/modules/deputyagent/core/`:
    `Action.kt` (`Action`, `NodeRef`, `ScreenContext`), `VerbMatcher.kt`,
    `Policy.kt`, `DefaultTrust.kt`, `Guard.kt`, `Gate.kt`,
    `ObservationBuilder.kt`, `Provider.kt` (messages, `ProviderJson`,
    `OpenAiCompatProvider`), `Tools.kt`, `AgentLoop.kt` (`Device` interface,
    `RunEvent`), `RunStore.kt` and `Prompt.kt`. `TreeDump.kt` now uses `NodeRef`.
  - Tests: one `*Test.kt` per file under `android/src/test/.../core/`.
  - `android/DeputyAccessibilityService.kt` (dump behind `Policy.preObserve`,
    `NodeRef` with depth and bounds) and the module's `android/build.gradle`
    (three dependencies).
  - Session 7: `core/DeviceRules.kt`; `android/DeviceAdapter.kt`,
    `AgentRuntime.kt`, `Notifier.kt` (`GateReceiver`, `RunService`),
    `StopChip.kt`, `KeyVault.kt`, `OkHttpTransport.kt` (+ JVM
    `android/OkHttpTransportTest.kt`); module manifest, `DeputyAgentModule.kt`,
    `src/index.ts`; `apps/deputy/App.tsx`, `src/RunPanel.tsx`, `src/setup.ts`;
    `docs/deputy/EVAL.md`. `SpikeProbes.kt` deleted.

- Phase 3 code (branch `deputy-phase-3`, uncommitted):
  - Core: `core/Settings.kt`, `core/TrustTable.kt`, `core/SavedTask.kt`;
    `core/RunStore.kt` gains `list`, `read`, `clear` and the `spent` carry. Tests:
    `SettingsTest` 8, `TrustTableTest` 7, `SavedTaskTest` 4, `RunStoreTest` +4.
  - Android: `android/OwnerStore.kt` (settings, trust, saved tasks, app list);
    `AgentRuntime` (settings, trust, `allowedApps`, history); the service's trust
    reads; `launcherApps()` shared in `DeviceAdapter.kt`; module functions.
  - TS/RN: `modules/deputy-agent/src/index.ts`; `App.tsx` (tabs);
    `src/SettingsScreen.tsx`, `src/AppsScreen.tsx`, `src/SavedTasks.tsx`,
    `src/History.tsx`, `src/settingsForm.ts` (+ test); `RunPanel.tsx` exports
    `StepRow`.
  - Docs: SPEC §4, §12, §13; EVAL.md Phase 3 section.

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
  The user chose "Commit, then release": committed 82 files as `0629439` on
  `deputy-phase-1` (untracked `CLAUDE.md` files and `.claude/rules/` left out),
  then released Store 9 and Deputy 2 (exit 0 both).
- 2026-10-29 (session 5): the user asked for a new-chat prompt to start Phase 2
  before the phone spikes are run. Rewrote the resume prompt and the next step for
  that (spike-independent core first, spike-dependent choices provisional), and
  added working notes for this machine. This handoff edit is uncommitted.
- 2026-10-29 (session 5, 00:24–01:22): phone testing over wireless debugging, at
  the user's request.
  - adb was used for screenshots, UI dumps, taps and logcat only. The Store 9
    update went through the Store's UI, and the user ticked HyperOS's accessibility
    risk box themselves.
  - Private apps were dumped structure-only, as the user chose.
  - Results: S1, S2, S3, S4, S5, S8 and S9 are answered (Evidence, "Phone spike
    results"). Only S7 is open.
  - Phase 2 inputs: keep the FGS; lift child labels onto clickables; use the IME
    path for Flutter typing; for secure windows, detect a blank frame or use
    `takeScreenshotOfWindow`; retry after about 350 ms; read notification extras
    and de-duplicate; make `onServiceConnected` and rebinds idempotent.
  - A parallel Phase 2 session (session 6) was working in the same tree on
    `deputy-phase-2`; this session edited only the handoff's spike text.
- 2026-10-29 (session 6): Phase 2 started. Cut branch `deputy-phase-2` from
  `0629439`. Asked for spike results: none run, no Gemini key (Evidence).
  The user approved three Gradle dependencies. Pure core done test-first, each
  suite RED (unresolved references, or assertion failures for the S4 lifting)
  then GREEN: VerbMatcher 6, Policy 15, DefaultTrust 3, Guard 6, GateNonce 6,
  ObservationBuilder 12; TreeDump 7 and ServiceSetting 6 still pass (61/61). The
  debug dump now goes through `Policy.preObserve`.
  Then the provider layer (ProviderJson 8, OpenAiCompatProvider 7, with an
  injected transport), Tools 5 and AgentLoop 19 (AC-1 to AC-7, first action only,
  stale index, stuck, question isn't approval, tap_at mapping, Stop on reply):
  100/100. A mutation check (removing `ensureActive()` before dispatch) failed the
  Stop-on-reply test, then passed when restored.
  Then `RunStore` 5 (log lines, active marker, AC-9 interrupted, retention,
  today's spend; `Step` events now carry the running cost so an interrupted run
  still counts) and `Prompt.kt` (prose, untested). Verification (real output):
  `pnpm test` exit 0, every package fail=0 (deputy 5/5); `pnpm typecheck` exit 0;
  `./gradlew :deputy-agent:testDebugUnitTest :app:assembleDebug` exit 0, JVM
  105/105, `app-debug.apk` built.
  Automated security review: `tap_at` hit-tested only the observation's index
  map, so a tap on Deputy's overlay, a blocked window or a labelled button the cap
  dropped went unjudged (Allow). Fixed: `Observation.all` keeps every visible
  node read (redacted, never sent) and `tap_at` hit-tests it; two tests RED, then
  GREEN (JVM 107/107). Not taken: confirming every unlabelled `tap_at`, which
  would gate every tap in custom-drawn apps (SPEC §8.4 known limit).
  `invariant-reviewer` (5 major, 5 minor) and `code-reviewer` (2 must-fix, 6
  should-fix, 4 weak tests, 3 nits) reviews. All of these were fixed test-first
  in two batches (10 RED, then 8 RED, then GREEN):
  - A tap is judged by the node it lands on (`Observation.clickTarget`, the
    nearest clickable ancestor), for `tap`, `long_press` and `tap_at`.
  - After an approval the screen is re-read; if the app or the target changed,
    the result is `stale_screen` and nothing is dispatched.
  - No screenshot while a blocked app's window was read, while the shade
    (System UI) is in front, or right after `press(recents)`; the foreground is
    re-checked before capture, and the model is told why it got none.
  - Shade, package-installer and permission-controller taps are confirmed;
    "approve" was added to the verbs.
  - Rule 1 also denies the permission controller showing Deputy, and a Settings
    row labelled Accessibility or special access.
  - `open_link` is judged by the app that opens it (`Device.resolveLink`, new).
  - The blocked-app Back goes through the Stop check, and cost can't go negative.
  - `Observation.all` strips text from blocked or own-window nodes, so none of it
    reaches the run log.
  - The gate draft is the whole message (field text plus the typed text), cut
    with "…".
  - Very long nodes are shortened to 2,000 characters instead of dropped.
  - Any unexpected exception ends the run `failed` with an end line.
  - `closeInterrupted` leaves this process's open run alone.
  - Every counted turn is logged, and a gate is logged as "waiting for the
    owner" before it is answered. `RunEvent.Step.verdict` gains `none` and
    `question`, which the TS contract must add.
  - The weak tests now fail under their mutations: gate expiry with no waiter,
    the dead gate after Stop, 30-day retention on its own, and offline retries
    (4 calls, 7 s).
  - `index: null` is treated as missing.
  Final verification (real output): `pnpm test` exit 0, all 9 packages fail 0;
  `pnpm typecheck` exit 0; the Deputy native gate exit 0 with JVM 126/126, 0
  errors, and `app-debug.apk` built.
  Left open, for the next session:
  - (nit) Two apps with the same exact label give an unresolvable "Several apps
    match"; let `open_app` take a package name and call `resolveApp` once.
  - SPEC §8.3 step 5 wrongly says rule 1 stops Deputy's own notifications; only
    the suspended loop does, plus the new shade confirm. Fix it with the
    post-spike SPEC update.
  - The reviewers' unverified risks: Gemini may reject `look`'s empty
    `properties:{}` (S7); a slide-to-pay SeekBar scroll isn't judged by label;
    whether heads-up windows appear in the tree; whether `Screen.title` really
    holds the Settings page title (the Android side must take it from the
    window title or the first heading).

- 2026-10-29 (session 7): asked for spike results (none new; S7 waits; Q5 is
  the free tier, see Evidence). Android side of Phase 2 built:
  - Core, test-first (RED, then GREEN): `open_app` takes a package name and calls
    `resolveApp` once; a missing screenshot is explained to the model; the shade
    is never read (see Decisions); new `DeviceRules` (gesture lines, blank frame,
    stale-node lookup, settle). JVM 135/135.
  - Android: `DeviceAdapter`, `OkHttpTransport`, `KeyVault`, `AgentRuntime`,
    `Notifier` (+ `GateReceiver`, `RunService`), `StopChip`; the service tracks
    `lastEventAt` and starts the runtime on connect. `SpikeProbes.kt` and the
    probe service are deleted; the manifest has `RunService`, `GateReceiver` and
    a `MAIN`/`LAUNCHER` `<queries>`.
  - RN: TS contract (run, gate, key, palette, `onRunEvent`), `src/RunPanel.tsx`,
    the key panel with the free-tier warning, Setup's key row and `canRun`
    (deputy 7/7). Spike probes UI removed.
  - Gate: `pnpm --filter deputy typecheck` exit 0; native gate exit 0, JVM
    135/135, `app-debug.apk` built.
  - Added after self-review: runs start from Home via the loop (Deputy's own
    screen in front means Home, inside the loop's Stop handling, tested);
    screenshots wait out a blocked app's notification; SPEC §1, §3, §4, §5, §6,
    §8.3, §8.4, §11 and §14 updated; `EVAL.md` written.
  - `code-reviewer` (1 must-fix, 6 should-fix, 3 nits) and `invariant-reviewer`
    (1 blocker, 6 major, 2 minor). Fixed:
    - OkHttp hang: an IOException while reading the body in `onResponse` never
      reached `onFailure`; now passed on. JVM test with a socket that cuts the
      body: failed (10 s timeout) with the old code, passes now.
    - `tap_at` and gesture fallbacks on unread windows (keyboard, System UI) are
      denied (`Screen.unread` areas into `ScreenContext`, Policy rule, tested), so
      a password can't be typed key by key and another app's heads-up can't be
      tapped. The Stop chip goes untouchable and invisible during gestures.
    - `screenshotSafe` no longer exempts Deputy's own windows and counts unread
      windows' packages (tested).
    - The Recents guard lasts until another app is in front (tested).
    - Approving inside Deputy now presses Back to the app before the re-check,
      instead of always ending `stale_screen` (tested).
    - Each gate's notification actions are distinct PendingIntents
      (`Intent.setIdentifier`), Approve needs an unlocked phone, and a question
      shows at most 2 option buttons, so the reply box still fits.
    - `active` stays true until a cancelled run has unwound (`isCompleted`).
    - `foregroundPkg()` is suspend and waits for a rebind; the screenshot's
      scaled bitmap and the hardware bitmap are recycled correctly; the
      blocked-notification check runs again after capture; `startRun` returns
      `{ runId, error }` so the error copy is plain; `GateCard` keyed by gate id;
      apps de-duplicated by package; `com.android.settings.intelligence` counts
      as Settings (tested); SPEC §4 matches `index.ts`.
  - Not taken: bounding `provider.step` by the time cap's remainder (each
    attempt is already capped by the 90 s call timeout, four attempts at most);
    extracting a tested `RunSlot` for the one-line `active` fix; editing the
    untracked `apps/deputy/CLAUDE.md`, which still lists `SpikeProbes` (not this
    session's file; the user should update or drop that word).
  - Automated security review: an http or https `open_link` was allowed without
    a gate, so injected screen text could send data out in a URL. Now it asks
    first and shows the full URL (Policy test RED, then GREEN); `EVAL.md` task 4
    swapped for a gate-free one, with the web search moved to AC-2c; SPEC §8.2.
  - Final verification (real output): `pnpm test` exit 0, all 9 packages fail 0
    (deputy 7/7); `pnpm typecheck` exit 0; `./gradlew :deputy-agent:testDebugUnitTest
    :app:assembleDebug` exit 0, JVM 144/144, `app-debug.apk` built.
  - The user said "commit, merge to main and release", then changed it to:
    test on the phone over wireless debugging first, commit only, no merge or
    push. Committed `2b116d5` on `deputy-phase-2` (47 files; untracked
    `CLAUDE.md` files and `.claude/rules/` left out). The first `pnpm release`
    was blocked by the auto-mode permission check; the user then said to
    release. `pnpm release deputy` → **Deputy 3 published** (0.1.0, 67.6 MB).
  - Store update over wireless debugging (adb taps only): Store → Deputy Update
    → installer "Do you want to update this app?" Update → Play Protect "App
    scan recommended" → Scan app → "This app looks safe" Install → Xiaomi "No
    risks detected" (ads, not tapped) → Open. Installed versionCode 3, installer
    `com.haroon.store`. The accessibility service stayed enabled and bound
    through the update; no crash in logcat.
  - First eval attempt (13:17–13:30 PKT; the user saved a free-tier Gemini key
    on the phone):
    - The adb-driven tap missed Run (the page had moved) and opened
      Accessibility settings, which brought forward the user's own open
      Settings stack (a HyperOS Google Assistant guide). Nothing was changed;
      Deputy was brought back with `monkey`. Glide-typing also garbled the task
      text while the keyboard was up, then it was fixed. Lesson: hide the
      keyboard and re-read bounds before every adb tap.
    - Task 1 (AC-1) ran: "Starting" for 236 s, then `failed`: "The model is busy
      or failing (HTTP 503)". No step was recorded and the cost was $0.0000, so
      every one of the 4 attempts (1 + 3 retries) got a 503 after about 57 s.
    - "Test the key" (text only, no tools, no image) also failed with HTTP 503
      after 192 s (about 45 s per attempt). The phone was on Wi-Fi, with no VPN
      active. So the endpoint or model returns slow 503s for any request; it
      isn't the screenshot or the tool schema. Not yet known: the 503 body,
      which the app doesn't show for 5xx.
- **2026-10-29, voice to text (user request, overrides PRD §8's "no voice
  input").** A Speak button under the task field calls the new `listen(prompt)`
  in `DeputyAgentModule`, which opens Android's `RecognizerIntent` dialog and
  returns the first result through `OnActivityResult`; the text is appended to
  the task. No microphone permission (the recognizer app records) and no new
  dependency; a phone with no recognizer shows the error under the field. Not yet
  tried on the phone. `pnpm --filter deputy typecheck` and `test` (7/7) pass;
  `./gradlew :deputy-agent:testDebugUnitTest :app:assembleDebug` built
  `app-debug.apk`, JVM 144/144.

- 2026-10-29 (session 8): the user said "start working on next phase of deputy".
  Found Phase 2 (`2b116d5`) and voice (`c705a73`) committed and Deputy 3
  released; the Phase 2 phone eval not run (no key on the phone). Asked: the user
  chose "Build Phase 3 now, eval later" and a new `deputy-phase-3` branch.
  - Core test-first: 23 new JVM tests failed on unresolved references, then
    passed (Settings 8, TrustTable 7, SavedTask 4, RunStore +4). The clear-history
    test exposed that `spentToday()` summed run files, so clearing would have reset
    the daily cap; fixed with the `spent` carry, and a mutation removing it fails
    the test.
  - TS test-first: `settingsForm.test.ts` failed on the missing module, then 3/3.
    It guards against `Number('')` turning a cleared price into $0.
  - Android, TS contract, RN tabs and screens; SPEC §4, §12, §13 and EVAL.md
    Phase 3 updated.
  - Verification (real output): `pnpm --filter deputy test` 10/10;
    `pnpm --filter deputy typecheck` exit 0; `./gradlew
    :deputy-agent:testDebugUnitTest :app:assembleDebug` exit 0, JVM 167/167,
    `app-debug.apk` built. Repo-wide `pnpm test` (9 packages, fail 0) and
    `pnpm typecheck` exit 0.
  - Reviews. `code-reviewer`: approve with comments (3 should-fix, 3 nits).
    `invariant-reviewer`: 3 major, 1 minor, plus the pre-existing prune gap. All
    were fixed, test-first where pure (4 new JVM tests RED on unresolved
    references, then GREEN):
    - The key is bound to its base URL.
    - Another model or address needs its own prices, and input and output prices
      must be above 0.
    - Trust is read live during a run.
    - The run-finished refresh moved into `Home`.
    - `SavedTask.allowList` is the tested conversion the module calls.
    - A Policy test checks that a blocked app stays blocked when a task lists it.
    - Minutes must be whole.
    - `spent` is written before deleting, and retention carries today's spend too.
    - The History footer says "newest 50" only when it is cut.
    `setTrust` is `@Synchronized`.
  - Final gate (real output): `./gradlew :deputy-agent:testDebugUnitTest
    :app:assembleDebug` exit 0, JVM 171/171, APK built 13:40; deputy TS 10/10;
    typecheck exit 0.
  - **Branch note:** during the session another session ran `checkout main` and
    fast-forwarded `deputy-phase-2` into `main` (local). `main`, `deputy-phase-2`
    and `deputy-phase-3` all sit at `c705a73`, and the checkout is `main` with
    Phase 3 uncommitted. Before committing, `git switch deputy-phase-3` (the tree
    carries over); it was left alone so as not to disrupt the other session.

- **Session 9 (2026-10-29/30): speed research and work** (Evidence, "Speed
  research"; Decisions, "Speed work"). Branch `deputy-speed` off `main`
  (`6daca33`), uncommitted. Part 1 (speed core) done: JVM 181/181, deputy TS
  10/10, typecheck clean, `:deputy-agent:compileDebugKotlin` exit 0.
  Part 2 (phone tools) done: JVM 186/186, deputy TS 11/11, typecheck clean,
  compile exit 0. New manifest permissions: READ_CONTACTS, SET_ALARM,
  ACCESS_NETWORK_STATE.
  Part 3 (route memory, several calls per reply) done. Gate (real output):
  `./gradlew :deputy-agent:testDebugUnitTest :app:assembleDebug` exit 0, JVM
  191/191, APK built 01:06; deputy TS 11/11; typecheck exit 0.
  Reviews: `invariant-reviewer` 1 blocker + 5 major, `code-reviewer` 1 must + 5
  should; all fixed test-first except as noted:
  - Search-field Enter: whole word "search" only, and text with `. / : @` or 5+
    digits is still confirmed (Chrome's bar hint is "Search or type web address").
  - `whatsapp:` links: only `whatsapp://send?` (group invites act on one tap).
  - The model's flag counts again on swipe and scroll (a swipe can archive or
    answer a call); still ignored for press, wait, look, open_app, open_settings.
  - `find_contact` goes through `Policy.lookup` for the resolved contacts app
    (blocked, allowed-apps); a blank name is refused.
  - `<memory>`: `<` escaped; steps in apps blocked now are left out (by label);
    recall runs in the run's coroutine, off the JS thread.
  - A reply runs at most 5 calls, never the same call twice, and checks the caps.
  - "clear" gates when another word follows ("Clear watch history").
  - Known models match with or without the trailing slash; `actMs` resets after
    each logged step; tapping a model row fills its prices.
  - Not fixed (minor, recorded): `open_settings` is judged as AOSP Settings
    (shortcut comment in `Policy.kt`); a 60 s retry-after can run past the time
    cap by up to 3 min (Stop still cancels).
  Gate after fixes (real output): native gate exit 0, JVM 199/199; deputy TS
  11/11; typecheck exit 0. SPEC/PRD sync handed to `docs-keeper`.

## Current state + exact next step

- **Speed work (session 9) is the newest state.** Committed on branch
  `deputy-speed` (the work, then "Deputy 0.2.0"), not merged or pushed. Parts 1–3
  built, reviewed and gated (session log); repo-wide `pnpm test` and `pnpm
  typecheck` exit 0. Not on the phone yet. Next:
  1. Reviews are fixed (session log). Check the docs-keeper's SPEC edits.
  2. Ask the owner to release 0.2.0 (`pnpm release deputy` after
     confirming the Cloudflare account), then in Settings pick "GPT-OSS 120B on
     Groq", save a Groq key (console.groq.com), "Test the key", and allow
     Contacts in Setup.
  3. On the phone, time EVAL Part 1 again plus "Send 'test' to <a contact> on
     WhatsApp" twice (the second run should use `<memory>`), reading
     `modelMs`/`actMs` from History. Compare with session 7 (49 s for task 1).
  4. Docs still describe one action per step and verbatim replay: SPEC §6 (tools),
     §7 (history), §9.3 (replay) need the docs-keeper pass.
  5. Not built (owner's call later): Jev executor, on-phone OCR, a backup model
     on Gemini 503s, skipping the first screenshot.
- Older state, before session 9:

- **Commits:** Phase 1 `0629439` (`deputy-phase-1`); Phase 2 `2b116d5` and voice
  `c705a73` (`deputy-phase-2`). **Phase 3 is on `deputy-phase-3`, uncommitted**
  until the user asks. Leave the untracked `CLAUDE.md` files, `.claude/rules/` and
  the OpenTunnel edits (another session's work) out of any Deputy commit.
- Earlier classifier stops (recorded in the log above) hit the PRD, the SPEC and
  an implementation how-to in previous sessions. None fired in sessions 4 to 8. If
  one fires again, stop, record it here, and don't reword the content.
- **Released so far:** Store 9, Deputy 2 (session 5) and Deputy 3 (session 7, the
  Phase 2 build), all to `https://apps-hub-store.haroonmukhtar4.workers.dev`, the
  personal account. Not merged to `main`, so the other apps weren't re-released.
  Voice and Phase 3 aren't released.
- **Phone spikes are done, S7 included** (Evidence; S7 run from the Mac in
  session 7). The S8
  locked retest moves to Phase 4.
- **Phase 2 is released (Deputy 3) but not phone-verified.** The first eval
  run failed on Gemini 3.8 Flash's 503s (session log, "First eval attempt");
  the user then switched the default to 3.5 Flash-Lite (Decisions).
- **Phase 3 code is done (session 8)**: trust screen, settings, history, saved
  tasks. Both reviews' findings fixed; JVM 171/171, deputy TS 10/10, typecheck and
  the native gate green. **The checkout is `main`** (another session moved it),
  so switch to `deputy-phase-3` before committing (session log, branch note).
  Local `main` now holds Phase 2: pushing it would make CI release every app the
  `packages/ui` brand edit touched (Evidence, "Merge side effect").
- **Exact next step: one phone eval covering Phases 2 and 3.**
  1. Ask the user whether to commit Phase 3 and whether to release it as Deputy 4.
  2. On their go-ahead, confirm the Cloudflare account, then `pnpm release
     deputy`. The user installs it through the Store.
  3. The user saves the API key (Settings tab), taps "Test the key", then runs
     `docs/deputy/EVAL.md`: Part 1 (five read-only tasks), Part 2 (AC-2 to AC-7),
     "Also check", then the Phase 3 table. Record every result, pass or fail,
     under Evidence, with the median step time and cost per task (NFR-1, NFR-2).
  4. Fix what the eval finds, test-first where the logic is pure. Likely spots:
     the **(phone)** items (blank-frame detection, a full-screen System UI window
     counted as unread, heads-up timing, the chip's position), and on the Phase 3
     side, `Segmented` inside the trust sheet and the app list's load time.
  5. Exit: SPEC §17 rows 2 and 3 (AC-1 to AC-7, FR-4, FR-5, FR-8 on the phone,
     numbers recorded). Then Phase 4 (schedules, notification rules, flood
     control; AC-8 to AC-10), which adds the Automations tab.
- The Gemini key is still in the Mac's Keychain (`deputy-gemini`) for more
  endpoint checks; delete it with `security delete-generic-password -s
  deputy-gemini` when the user says.
- Done in session 7: `SpikeProbes.kt` and the probe service are deleted; the FGS
  permissions stay for `RunService`.
- Before each session ends, run `pnpm test`, `pnpm typecheck`, the Deputy native
  gate and the `invariant-reviewer` and `code-reviewer` agents. Update the
  session log at each milestone, and hand off at about 85% context.
- Exit: SPEC §17 Phase 2 row. JVM tests green; AC-1 to AC-7 on the phone, with
  five read-only eval tasks first; `docs/deputy/EVAL.md` written; measured cost
  and time recorded here.
- Merging `deputy-phase-1` to `main` is still the user's decision (Evidence,
  "Merge side effect").
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
    project). Agreed method (session 5): the user runs
    `security add-generic-password -a "$USER" -s deputy-gemini -w` in their own
    Terminal (it prompts, so the key stays out of shell history), then says "key
    saved". Test commands read it with
    `security find-generic-password -s deputy-gemini -w` and pipe it into curl's
    header via `-H @-`, so it never appears in a file, a log, argv or the chat.
    Afterwards, `security delete-generic-password -s deputy-gemini`. Never ask the
    user to paste the key into the chat. Paid billing must be on (the free tier
    trains on content).
- **After the spikes:** done in session 7 (FGS kept, cap and screenshot rules,
  accessibility events for S8, SPEC updated).
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
