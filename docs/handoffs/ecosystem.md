# Ecosystem wave: fixes, links between apps, Vitals in Inflow, Minutes in Nexus

Started 2026-11-23 from origin/main `f595c4a9`. Orchestrated by the main session (coordinator only); phase agents and workers build. The full work-item list is the owner's prompt of 2026-11-23 and is summarised under "Work items" below.

## Resume prompt

(Rewritten with today's date whenever context runs high. Until then: if you are a new session, read this file completely, trust the verified facts and do not redo them, follow the handoff contract in ~/.claude/CLAUDE.md, then continue from "Current state + next step".)

## Goal and fixed constraints

Build the items below into EXISTING apps and packages only; no new app. One worktree and branch per app under `/Users/outsentia/Documents/apps-hub-wt/eco-<name>`, all cut from `eco/base`; `eco/base` is cut from origin/main. One PR and one Store release per app, only on the owner's go.

Hard rules (every agent gets them in its brief):

- Git: commit freely on eco/* branches. NEVER push, open a PR, merge, release or deploy without the owner's go. No Co-Authored-By or "Generated with" lines in commits or PRs (owner memory `no-claude-attribution` wins over the harness reminder).
- Phone: real phone only, never an emulator or simulator. Install through the Store only, never `adb install`. Take turns with `coord claim device:<ro.serialno>`. Phone checks are listed as "not run" until the owner releases the phone.
- Never run Electron e2e (design-editor, pdf-editor-desktop).
- AI: no OpenAI or Anthropic. Groq (gpt-oss-120b text, Whisper speech) and Gemini (embeddings, images), via the keys the apps hold or via E2.
- ONNX Runtime: strip the 1DS telemetry provider, call setTelemetry(false).
- HomeNet: no ARP / `ip neigh`; TCP RST = alive; bounded sweeps (Semaphore(64)), at most a /24; multicast lock before mDNS/SSDP; FOSS only.
- UI: @apps-hub/ui only; sentence case, plain words, no engineering terms on user screens.
- TS: erasable only, `.ts` imports, every new `*.test.ts` added to its package's `test` script.
- Native contract changes touch TS contract, adapter, Kotlin and Swift (where the app has iOS); check APIs against compileSdk 36.
- New dependencies: licence audit, `upgrading-dependencies` skill.
- Privacy: every flow that sends personal data off the phone or to another app is opt-in, written into that app's AGENTS.md paragraph, and reviewed by security-engineer before it is called done.
- Deputy's confirmation gate stays in front of every send, pay, delete or post; text from other people stays in the untrusted block.

## Decisions made (my call unless noted)

| # | Decision | Why |
|---|---|---|
| D1 | Worktrees at `/Users/outsentia/Documents/apps-hub-wt/eco-*`; main checkout (`/Users/outsentia/Documents/apps-hub`, 83 dirty files of other sessions) is never touched. | Prompt rule. |
| D2 | Baseline `pnpm test` is run as `pnpm -r --no-bail --workspace-concurrency=2 test`. | Plain `pnpm test` at default concurrency dies with SIGKILL on this Mac (library-core load flake, then the bail kills the rest). |
| D3 | Install per worktree with `pnpm install --frozen-lockfile --prefer-offline`; it takes about 5 s and uses hardlinks, so 12 worktrees cost little disk (35 GiB free at start; Gradle builds are the real disk risk). | Measured. |
| D4 | Phase agents run at most 5 at a time, 1 to 2 workers each, so no more than 10 agents are alive. | phased-orchestration ceiling. |

## Evidence already verified (do not re-derive)

- origin/main at start: `f595c4a9` (Strongroom extension 0.4.0, #69). Local `main` in the main checkout is old (`226a9470`); ignore it.
- Baseline on eco/base (= origin/main) 2026-11-23: `pnpm -r --no-bail --workspace-concurrency=2 test` exit 0 (30 packages, 0 failures); `pnpm -r --no-bail --workspace-concurrency=2 --if-present run typecheck` exit 0, 0 `error TS`. Default-concurrency `pnpm test` fails with library-core / strongroom-core / sieve-core SIGKILL (load, known).
- Gradle baselines: recorded per app by each phase agent at its start (see session log).
- Phone: one physical device is connected over wireless adb (serial changes; use `adb shell getprop ro.serialno` for the coord key).
- Recon of unmerged branches: see "Reuse table" (filled in from the recon agent).

## Reuse table (item 4 of start-up; recon 2026-11-23 against origin/main f595c4a9)

Branches are mostly squash-merged, so "ahead N" overstates what is unmerged. Verified by diffing branch tips against the squash commits.

| Item | Finding | Decision |
|---|---|---|
| `tunnelwall-firewall` | On main as #14 (5d2de26f), a superset. No firewall kill switch or trusted-Wi-Fi code exists anywhere (the only kill switch is the VPN one: `enableKillSwitch` in App.tsx and OpenTunnelVpnService.kt). | Do NOT rebase (21 conflicts, already merged). C3 "land the branch" is a no-op; build only kill-switch hardening, best relay, trusted Wi-Fi. |
| `text-ocr-pr` | No such ref. OCR is on main: #58, null-bounds fix #68; Nexus (`apps/pdf-editor-mobile`) depends on `text-ocr`, `app/scan-text.tsx`. Engine Tesseract4Android 4.9.0 (Apache-2.0), English-only `eng.traineddata` (tessdata_fast, Apache-2.0), sha256-pinned in build.gradle. | C8 shrinks to: verify what ships, audit licences, add what is missing (see C8 brief). |
| `design-media-phase-4` | On main as #24 (6a005527). | Nothing to do. |
| `strongroom-passes` | On main as #48. | Nothing to do. |
| `inflow/post-release`, `inflow/stage-4b`, `inflow/receipts` | On main (#42, #35, cff47c0a). | Nothing to do. |
| `autopilot` / `autopilot-stage-1` | Stage 1 on main (#52): `packages/autopilot-contract`, Inflow Autopilot*, Deputy RunSuggestion. No `autopilot-stage-1` ref. Stage 2 (Halo edge pulse, AOD Waiting row, bubble, daily digest) not started anywhere. | B1 builds Autopilot stage 2's digest once; no second digest. |
| `photo-search` | Floor fix on main (#40). Only the handoff doc 5a53d05a is unmerged. | Optional cherry-pick of the doc; skipped (not in scope). |
| Halo m1/m2 | Not fixed on any ref (AodActivity.end() has no isFinishing/keyguard check; no onStop/isInteractive handling). | F4 rebuilds both. |
| `deputy-make-video` (F5) | On main (#23). 429 wait with retry is `RATE_DELAYS` in Provider.kt; saved-files report is `AgentLoop.made`; no re-download is `Slideshow.arrivals`; multi-key 429 fallback #57. The handoff still calls them follow-ups. | F5 becomes verify-and-close: prove each behaviour with tests, fill only real gaps, fix the stale handoff text. |
| Nexus shortcuts (F6) | Not fixed on any ref: cited PDF opens at page 1; recordings over 25 MB rejected (`MAX_UPLOAD` in `src/nexus/content.ts`, "shortcut: split" comment); tab bar over keyboard on Stream. | F6 rebuilds all three. |
| Clipboard Phase 1 | Not built; `android.permission.INTERNET` still in the manifest, no expiry or pin code. | C1 rebuilds. |
| `homenet-toolbox` | On main as #47. | Nothing to do. |
| `ai-hub` | Hub on main (#66): `com.haroon.aihub` owns the Gemini/Groq key ring in a Keystore vault; bound service `com.haroon.aihub.BIND` guarded by signature permission `com.haroon.permission.AI_HUB`; no app binds it yet. Only `ai-hub-ui-fixes` 833e41fa unmerged. | Affects E2: see "Open owner decisions" 1. The key ring already exists in AI hub. |
| Share targets (E3) | No SEND / SEND_MULTIPLE intent filter in pdf-editor-mobile, design-editor-mobile or deputy. Existing filters are VIEW only. Gradle dirs are `apps/<app>/android`. | E3 adds filters; check how each prebuild is committed first. |

## Work items and status

Status key: todo / in progress / built / gated / reviewed / not run.

| Id | Item | Branch | Status |
|---|---|---|---|
| F1 | Release guard | eco/base | built + gated (468c9211); invariant-reviewed; @apps-hub/release 35 pass |
| F2 | Rollback | eco/base + eco/store | release side built + gated (38891621, 0cf71791, 8b8db0d1; manifest 8 pass); dry-run only, real rollback needs owner go; Store row built (6510ec60: "Build from commit <7 hex>", store tests 11 pass, store gradle ok); no rollback flag in the manifest so no "rolled back" line (needs an optional field, not built) |
| F3 | Docs drift | eco/base | built (e07c189f, 9f63af1a, f2e72447, 8e9a93bd); more AGENTS.md text pending from apps |
| F4 | Halo m1/m2 minors | eco/halo | built + gated (0f60b826, 4ece59ca); halo-engine 165 tests, notch-island 109, assembleDebug ok, halo ts 126 pass; phone not run |
| F5 | Deputy reliability (verify and close; code is on main) | eco/deputy | built + gated (1eef0a8b, e7b5b9b0): only gap was Retry-After as an HTTP date; Deputy gradle 267 -> 274 tests, 0 fail; deputy ts 12 pass; phone not run |
| F6 | Nexus shortcuts | eco/nexus | built + gated (6134b70e, aeae7091, 5624026f, 92385261): pdf-editor-mobile 47/47, knowledge-core 67/67, engine 2/2, gradle ok; new module audio-chunks (Android only); phone not run |
| E1 | app-link-contract | eco/base | built + gated + security-reviewed (commits 18657714 ... fda0631b): app-link-contract 91/91, autopilot-contract 5/5, inflow ts 91/91, Inflow gradle 578 tests; phone not run |
| E2 | AI keys once (built on AI hub, not Strongroom: see E2 decision) | eco/ai-hub + readers | hub slice + ai-hub-client BUILT + gated (eco/ai-hub a22cc525): hub JVM 118 (101), ai-hub ts 8, ai-hub-client ts 10 + Kotlin 6 (compiled via an init script, hub must not link the client: AIDL duplicate), app-link-contract 91; SECURITY FIX 60875260 (client checks hub identity: checkSignatures before bind, exactly one exported service guarded by AI_HUB, bind the checked component, re-check on connect; client Kotlin 12/12); default-deny + pending list + per-call log + apiVersion 2 (embed dimensions, transcribe segments); streaming becomes apiVersion 3; dimensions unproven on live Gemini endpoint; phone not run; security-engineer review pending; no app is wired yet; app integrations (Inflow, Nexus, Design Editor phone, Deputy) wait until their current phases finish |
| E3 | Share targets | eco/nexus, eco/design-editor, eco/deputy | Design Editor built + gated (80d68de8): app tests 120 (105), media-core 184, gradle JUnit 309 (300), merged manifest has SEND/SEND_MULTIPLE image+video, plugin + manifest test; phone not run; pre-existing lint errors (3) in photos.tsx, [tool].tsx, CleanupOverview.tsx not fixed. Deputy built + gated (3a74c513): JVM 315 (299), deputy ts 17 (15), app-link-contract 91, APK has SEND filter; separate ShareActivity declared in the module manifest (survives re-prebuild); RunSuggestionActivity hardening NOT added (Inflow starts it with plain startActivity so callingPackage is null; a check would refuse every Run tap): B3 must handle this; phone not run. Nexus in progress |
| E4 | Store health hub | eco/store | built + gated (c5c7f1d2): store ts 22 (11), store-manifest 8, app-link-contract 133, gradle ApkVerifier 7 + Deadline 3, assembleDebug ok, Metro release bundle exit 0; Store holds AUTOPILOT permission; phone not run (HyperOS listener read may say unknown) |
| C1 | Clipboard smart actions + phase 1 | eco/clipboard | built + gated (6f2ba514): clipboard ts 21 (7 before), gradle JVM 32 (24 before), release manifest has no INTERNET (test fails if it returns); Add to Inflow NOT built (needs an Inflow E1 action; extension point `actionFor()` in src/smart.ts); phone not run; security-engineer + invariant review pending |
| C2 | Deputy repeating tasks | eco/deputy | built + gated (d23c625a): Deputy gradle 299 tests (274 before), deputy ts 15 pass, typecheck ok, WorkManager 2.12.0 Apache-2.0 no gms; gate unchanged (test proves scheduled run meets same gate); phone not run; security-engineer review pending |
| C3 | TunnelWall (firewall already on main) | eco/tunnelwall | built + gated (73fcb21e, c13b0e52, 93bccc5a, 0af9d514): open-tunnel-core 38, open_tunnel_vpn ts 150, gradle JVM 52, assembleDebug ok, expo-doctor 16/18 (same as baseline); iOS NOT compiled (no Pods); phone not run; invariant-reviewer pending. Kill switch: real gap was that it did nothing on Android (engines host their own VpnService); now an in-app blocking interface. Trusted Wi-Fi adds ACCESS_FINE/COARSE_LOCATION (runtime, only when switch is on) |
| C4 | HomeNet | eco/homenet | built + gated (a7341fef): core 349 (298), app-link-contract 91, gradle JVM 58 (26) assembleDebug ok, no gms on release classpath; hard rules table in report (no ARP, RST alive, /24 Semaphore(64), no multicast needed, FOSS); iOS Swift only parsed (no Pods), returns supported:false; phone not run; who_is_home share carries people names (security-engineer review); worker ran `gradlew --stop` (may have interrupted other Gradle builds) |
| C5 | Strongroom health report + expiry share | eco/strongroom | built + gated (5a547062): strongroom ts 109 (102), strongroom-core 187, gradle 661 tests (628) 0 failed, app-link-contract 91; common list SecLists 10k MIT (+31 KB compressed); passes have NO expiry date in the vault format so only cards produce rows (pass dates need a vault-format change: owner decision); expiry share needs security-engineer review; phone not run |
| C6 | Halo progress ring | eco/halo | built + gated (c230590a): halo-engine 165, notch-island 127, halo ts 127 pass, assembleDebug ok; default ON (my call); phone not run; security-engineer look pending |
| C7 | Design Editor brand kit from image | eco/design-editor | built + gated (4fc78b36): engine 48/48, design-editor-mobile 105/105, design-editor 9/9 (unit), mobile tsc ok; engine is classic JS (image-maths.js), ui WCAG helper is private to its test so formula is duplicated and pinned by known values; UI is DOM code never run in a window or phone |
| C8 | Nexus offline OCR (on main; verify, audit, fill gaps) | eco/nexus | todo |
| C9 | autonomous-browsing dry run | eco/autonomous-browsing | built + gated (d4ab7da7): vitest 514 pass (500 before), tsc clean; real-window check not run; open: assert probe waits default timeout on missing targets |
| V1-V5 | Vitals in Inflow | eco/inflow | V1-V4 in progress (phase vitals); V5 waits for E1 final |
| M1-M5 | Minutes in Nexus | eco/nexus | M1,M2,M5,M4 + E3-Nexus + C8 in progress (phase nexus-w2); M3 needs E1/B3 |
| B1-B6 | Cross-app wave 3 | various | todo |

## Findings to carry (from F-base)

- Android refuses a lower versionCode over a higher one; `adb install -d` and the Store installer both fail on a release APK (AOSP isDowngradePermitted: debuggable only). Rollback = rebuild old commit with versionCode = published + 1, versionName stays old.
- apps/inflow/android/app/build.gradle is NOT wired to the shared signing key; a release rewrites it in the caller's tree so the next `pnpm release` refuses until reverted. Fix belongs on eco/inflow: commit the wired file (tell the Vitals phase).
- apps/ai-hub is not in the release list (no Store release path): not guaranteed shared-key signed (E1 finding); matters for E2.
- Releases before F1/F2 have no recorded commit: the first rollback of each app needs `--to <sha>`.

## E1 outcome (for later phases)

- Contract: packages/app-link-contract (README has "how an app adds a share/action", threat model, phone checks). One permission `com.haroon.permission.AUTOPILOT` exported as LINK_PERMISSION (R1: a rename needs a coordinated release of every app). Kotlin guard is canonical copy-in files (AppLinkGuard.kt, AppLinkCaller.kt) with a drift test. Guard also re-checks the caller cert (checkSignatures).
- Signing: all releases use the ONE Store key. Signature trust holds only for Store-installed builds: every committed debug.keystore is the same public Expo debug key, so a debug-built app would trust anything signed with it. `apps/ai-hub` is NOT in the release list, so it has no trust path yet (matters for E2).
- Open from E1: Deputy's RunSuggestionActivity (headless, grandfathered) has no callingPackage check or extras validation; any same-key sibling can start it (add when Deputy is next touched, B3 will). First action author must add the second caller check for activities (R7). Inflow `items/#` and `update` paths are legacy; new shares must not copy them; OTP filtering in AutopilotAccess not traced (check before E3/B2).
- Metro: nothing imports app-link-contract at runtime yet; the first app that does must list it as a dependency and bundle once.

## Findings to carry (from C1)

- Clipboard smart actions put a tracking number or an address in a URL/geo query sent to the browser or map app, only on a tap, never by Clipboard itself (no INTERNET). COMMON.md's "no user data in URLs" rule was written for web forms; this is the feature, but security-engineer must confirm and the owner is told.
- HyperOS: "Turn on" cannot open Clipboard's own accessibility page (ACTION_ACCESSIBILITY_DETAILS_SETTINGS is not in the public SDK); it opens the accessibility list instead.

## E2 decision and plan (planner report 2026-11-23)

- origin/main moved to 1ba92561 (#70 hub UI, #71 Store knows AI hub and registers it for release); merged into eco/base (e606c7e7). So ai-hub HAS a release path now (whether a hub build is published: unverified).
- Hub today: Keystore AES-GCM key list, no API hands a key out; AIDL v1 submit/cancel/status/apiVersion guarded by signature permission com.haroon.permission.AI_HUB; jobs chat, vision (7 MB image), embed (8 texts), transcribe (25 MB, text only); request JSON capped 512 KB; no streaming; hub picks models. Unknown same-signed apps are allowed by default today; only counts are kept (no per-call log).
- Option C (Strongroom holds keys) goes against code: handoff says Strongroom never calls the hub; CallerPolicy always denies Strongroom; E1 refuses apikey/secret/token columns. Option B (hub hands keys over) puts keys in five processes. CHOSEN (my call): Option A, apps call hub submit(), keys never leave the hub, own key fields stay as fallback.
- Hub slice: default-deny for unknown apps + pending list; capped per-call log (app, job, service, time, never text); embed `dimensions` and transcribe `segments` (Nexus needs 512-dim vectors and Whisper segments); ApiVersion 2. Client: packages/ai-hub-client (Expo module, AIDL copy with drift test, fallback error kinds).
- App integrations later: Inflow (AiConfig.provider()), Nexus (src/nexus/ai.ts, embeds in chunks of 8, dims 512), Design Editor phone (src/editor/ai.ts), Deputy (AgentRuntime.kt:77 HubProvider; screenshots may exceed 512 KB: check). Deputy and Inflow lose their own model/effort/base-URL choice on the hub path (fallback keeps them).
- Owner questions for E2: (1) keys in AI hub not Strongroom; (2) Option A not B; (3) keep own key fields as fallback or delete them (the hub PLAN P3 says delete); (4) per-call log or counts only; (5) default-deny and re-enable apps; (6) Deputy/Inflow lose model/effort/base-URL choice on the hub path; (7) release ai-hub through the Store (needed before any phone test).

## Wave 3 plan (planner report 2026-11-23; execute after Gate 0)

NOTE: commit ids written earlier in the work-item table are PRE-REBASE ids (I rebased idle branches onto eco/base). Use branch tips from `git -C <worktree> log`, not those ids. Tips at 2026-11-23 evening: halo aeea0ac3, deputy 04ce7009 (+E3 uncommitted), store 6c72cca6, autonomous-browsing 87105433, strongroom 5a547062, design-editor 80d68de8, tunnelwall 923ad459, clipboard 837c821c, nexus f0c47c52 (phase running), inflow cd9ea10a (Vitals running), homenet (C4 uncommitted), ai-hub e606c7e7 (E2 slice running).

Facts (checked in code): no Autopilot stage 2 code or plan exists (only stage 1 plan; spec 8.4: Inflow posts the digest at 08:00 and 20:00), so B1 builds the digest first time with the briefing in the 08:00 one. The Store can read accessibility and notification-listener state of any app itself from Settings.Secure (Deputy/Clipboard/Halo already parse those keys; HyperOS allowance for the listener key unverified); a share is the fallback. HomeNet is `app.netlens`, TunnelWall `com.opentunnel.open_tunnel_vpn`: E4 must use ANDROID_PACKAGES, not a com.haroon prefix. Share authority names must match /^com\.haroon\.[a-z][a-z0-9]*\.applink$/ (map pdf-editor->pdfeditor, open-tunnel->opentunnel, design-editor->designeditor); column names cannot contain `key` as a word (use `ai_source`). Second caller check for activities only works with startActivityForResult from an Activity (Deputy runs in a service, so a Deputy task can never pass that check when it calls another app); so B3/B5/M3 buttons live in app screens, never notifications or services. OTP filter: SqlItemStore.kt:588 NEVER_SEND_FILTER. Strongroom has no Wi-Fi entry kind and no QR; HomeNet has a guest Wi-Fi QR (RouterScreen.tsx GuestWifiCard).

Shared "app health" share (packages/app-link-contract/src/health.ts): row {app_id string, accessibility int?, listener int?, ai_source string (hub|own|none), last_seen_at long?}, maxRows 1, path `health`, one per app provider; fixture fixtures/app-health.share.json; no personal data. Store shows Settings.Secure value first, app's report second, mismatch = "Not sure".

Links: B1 Inflow `briefing` share {line_id, kind, text, at?, private int} (text built in code, e.g. "Medicine at 14:00"), readers: HomeNet who_is_home, Strongroom expiry, Deputy `waiting` {id,label,due_at?,state}, Nexus `today` {id,title,due_at?}; data-free `com.haroon.autopilot.CHANGED` broadcast to Halo only. B2 Inflow `ask_items/<sinceId>` (NEVER_SEND_FILTER, SMS+email only, no OTP, never health) and `ask_ids/<sinceId>`; Clipboard `pinned` {id,text,pinned_at,from_app} (no sensitive); Deputy `runs` {id,task,state,finished_at}; Design Editor photos via E3 SEND_MULTIPLE intake with setPackage to Nexus (screen first; departs from "through E1": owner confirm). B3 `com.haroon.deputy.action.PROPOSE_TASK` screen:true, extras task<=300, context<=2000 (untrusted), apps[]<=20, ref; opens E3 Draft screen; same commit hardens RunSuggestionActivity (validateExtras + callingPackage). B4 TunnelWall `shield` {on, untrusted_now, since}; switch lives in TunnelWall (my call: owns trusted Wi-Fi, location permission, auto-connect); HomeNet sends CHANGED to Halo on new device; Halo red pulse; Strongroom Wi-Fi passwords never cross (optional SHOW_WIFI needs a new entry kind: owner decision, planner says skip). B5 all inside Design Editor, then "Post with Deputy" sends PROPOSE_TASK; a Design Editor action called BY Deputy is not possible (service caller fails the second check): owner confirm this reading. B6 Inflow `debits/<sinceId>` {id,amount_minor,at,merchant,account}, 60 days, max 500; Nexus matches on the phone only and never indexes transactions into Ask; warranty reminder = Inflow ADD_TODO at warranty date minus 14 days. M3 `com.haroon.inflow.action.ADD_TODO` screen:true {title<=200, due_at, note<=500, source<=40}; Minutes items get "Add to Inflow" and "Do with Deputy". Clipboard "Add to Inflow" (actionFor() in src/smart.ts) uses ADD_TODO too.
Second caller check built once: canonical copy-in `AppLinkActivityCaller.kt` (callingPackage non-empty AND checkSignatures == MATCH), copies.test.ts extended.

Privacy defaults (all opt-in; each in its app's AGENTS paragraph): Inflow briefing line notification VISIBILITY_PRIVATE with public count-only version; "Show medicine name on always-on screen" off (private=1); "Let Nexus read messages" off; "Let Nexus match receipts" off; Halo "Briefing on always-on screen" off; Clipboard "Let Nexus read pinned clips" off (first route from Clipboard to an app with internet); Deputy "Let Nexus read run history" off; Strongroom expiry + names off; HomeNet shares off; TunnelWall Shields off; Nexus each source switch off, turning off deletes items, chunks, vectors, FTS rows; embeddings go to Gemini, answers to Groq (write it down).

Gate 0 (before P1): E3-Deputy committed; C4 committed; C5 committed (done); Vitals V1-V4 done and V5 changed to "serve no share, briefing share replaces next dose and steps" if not started; nexus-w2 done; owner answers (E2 decision, B4 switch, B2 photo route, B5 reading, Strongroom Wi-Fi kind, M3 'owner picks which' = per-item choice).

| Phase | Worker A | Worker B | Needs |
|---|---|---|---|
| P1 | eco/base: health factory + fixture, AppLinkActivityCaller.kt + copies test, README sections, PROPOSE_TASK and ADD_TODO specs with fixtures | eco/deputy: PROPOSE_TASK activity, RunSuggestion hardening, `waiting` and `runs` shares, health row | Gate 0 |
| P2 | eco/store: E4 Health screen (Settings.Secure + shares, Autostart guidance via ACTION_APPLICATION_DETAILS_SETTINGS, listener page via ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS) | eco/inflow: stage 2 digest + briefing share + readers, CHANGED sender, ADD_TODO, ask_items/ask_ids/debits, Bills "Do it via Deputy", health row | P1 |
| P3 | eco/halo: stage 2 (edge pulse, AOD Waiting + Briefing rows, bubble, CHANGED receiver, Shields pulse, health row) | eco/nexus: B2 ingest + switches, `today` share, M3 buttons, "Do it via Deputy", health row | P2 |
| P4 | eco/tunnelwall: Shields switch, `shield` share, health row | eco/homenet: CHANGED ping, Shields alert, "Restart the router with Deputy", health row | P1 |
| P5 | eco/design-editor: B5, Send to Nexus, health row | eco/nexus then eco/clipboard: B6 receipts, Clipboard `pinned` share + ADD_TODO button + health row | P2, P3 |
| P6 | eco/strongroom health row; docs pass (AGENTS paragraphs, ledger) | security-engineer + invariant-reviewer over every new link, B2 deletion path, Halo lock-screen lines | all |

Before each phase: P1 commit is in eco/base and merged into the worktree; worktree clean; other phase for that app done (Inflow and Nexus take one worker at a time); `auditManifest` and `copies.test.ts` pass on the branch.
Risks: no phone check has ever run and everything depends on Store-signed builds (debug fails closed); Halo reading a provider on the lock screen; TunnelWall Shields only while the process is alive; router restart may hit a login page (must stop at the gate, no credentials cross); Nexus `ask_ids` re-sync pages of 500.

## Wave 3 progress

- P1-A DONE on eco/base (240b8f40): app-link-contract 133 tests (91), autopilot-contract 5, inflow ts 91; `appHealthShare(app)` + fixtures, `AppLinkActivityCaller.kt` canonical (+ copies.test, mutation proven), `PROPOSE_TASK` and `ADD_TODO` via defineAction (ADD_TODO extra is `dueAt`, camelCase only), `CHANGED_PING` constant; README sections. Health authorities: pdf-editor->pdfeditor (this is Nexus), open-tunnel->opentunnel, design-editor->designeditor, ai-hub->aihub, netlens->com.haroon.netlens.applink, inflow keeps legacy com.haroon.inflow.autopilot, deputy/strongroom/clipboard/halo com.haroon.<id>.applink. (The worker wrongly said Nexus lives in design-editor-mobile; Nexus is pdf-editor-mobile.) Open: no health-row validator for readers (P2 Store should validate at its boundary); CHANGED receiver permission not audited; README "Signing finding (c)" still says ai-hub has no release path (stale, docs pass). AGENTS.md text for app-link-contract is in eco-work/agents-md-paragraphs.md.

- P1-B DONE on eco/deputy (56bf66a0): Deputy JVM 339 (315), deputy ts 24 (17), app-link-contract 134; PROPOSE_TASK activity (waits in the caller's task on a small screen until the owner saves/starts/closes the draft; result handed_over/cancelled), provider com.haroon.deputy.applink with health (always), waiting (opt-in, owner-given names only), runs (opt-in, owner-typed tasks, only served to com.haroon.pdfeditor), `ai_source` is own when a key is saved else none; RunSuggestionActivity still NOT hardened (Inflow starts it with plain startActivity): the B3 line in the plan that says "same commit hardens RunSuggestionActivity" is wrong/obsolete; phone not run.

## Security findings handled during the build (automated reviews)

- ai-hub-client did not verify the hub identity (package squatting): fixed, 60875260 on eco/ai-hub.
- Share intakes copying the receiver's OWN files (confused deputy via own FileProvider URIs, authority userinfo bypass): Design Editor was NOT safe and is fixed in ba7cb514 on eco/design-editor (content:// only, strict authority parse, own-authority list + resolver check, /proc/self/fd private-path check, JVM 316, app 120, media-core 184). Gaps: the /proc check is skipped if /proc is unreadable (does not fail closed; security-engineer to decide), and the app's FileProvider `<paths>` were not narrowed (library resources). Nexus intake: fix requested from the nexus-w2 phase agent (pending). Deputy takes text only, not affected.

## Open owner decisions (collect here, ask once at the end)

1. Strongroom holds the shared AI keys (E2): the prompt says yes, but AI hub (#66, on main) already owns a Keystore key ring for Gemini and Groq with a signature-guarded bound service. (my call, pending owner) E2 will build on the AI hub, NOT duplicate a key store in Strongroom, unless the owner says Strongroom must hold them. Needs owner confirmation.
2. Health data to Ask AI or Autopilot (V4): default off.
3. TunnelWall auto-connect on untrusted Wi-Fi (C3): built default off. NEW for owner: it needs precise-location permission (Android only shows the Wi-Fi name to apps with it), asked only when the switch is turned on; works on Android 12+ and only while the app process is alive. Say if you would rather identify networks without location (rejected: gateway address is not unique).
4. Where the Shields switch lives (B4): (my call, to write down).
5. Repeating Deputy tasks that include payments (C2): built as `ScheduledRun.PAYMENTS_ALLOWED = true` (a paying task can be saved, but always stops at the gate; false refuses to save them). Owner flips it.
6. C2 auto-start: the PRD default was a "Tap to run" notification; I built auto-start on an unlocked phone (PRD FR-9 and SPEC section 11 updated). A scheduled run may take over the screen while you use the phone (alternative: 10 s "starting soon, Not now" warning). Owner confirms.

## File map

- AGENTS.md paragraph text collected from agents: `/Users/outsentia/Documents/apps-hub-wt/eco-work/agents-md-paragraphs.md` (applied by the final docs pass).
- Ledger: `docs/handoffs/ecosystem.md` (this file; main session writes it).
- Phase workspaces: `/Users/outsentia/Documents/apps-hub-wt/eco-work/<phase>/` (briefs, progress.md, locks, shared-files.txt). Outside the repo.

## Session log

- 2026-11-23: F-base, F6 done; Store row done; Nexus wave 2, Vitals, C9, C2, C3 running. Disk is tight (about 30 GiB): COMMON.md now tells agents to delete their worktree build output when done.
- 2026-11-23: session interrupted; five agents resumed. F4 done. C6 started.
- 2026-11-23: recon done (Reuse table). F-base and E1 phase agents dispatched.
- 2026-11-23: start-up read, fetched origin, created `eco/base` and eleven app worktrees, installed deps, baseline gates green (above).

## Current state + next step

State: Wave 1 done; Wave 2 mostly built (see table); running: C4 HomeNet, Nexus wave-2 phase, Vitals phase, E3-Deputy, E2 hub slice. Next: when those finish, Gate 0 then Wave 3 phases P1 to P6 (plan above), then Wave 4 (reviews, gates, requirements-verifier, final report).
