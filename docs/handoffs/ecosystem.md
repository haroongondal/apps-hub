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
| F1 | Release guard | eco/base | todo |
| F2 | Rollback | eco/base + eco/store | todo |
| F3 | Docs drift | eco/base | todo |
| F4 | Halo m1/m2 minors | eco/halo | built + gated (0f60b826, 4ece59ca); halo-engine 165 tests, notch-island 109, assembleDebug ok, halo ts 126 pass; phone not run |
| F5 | Deputy reliability (verify and close; code is on main) | eco/deputy | todo |
| F6 | Nexus shortcuts | eco/nexus | todo |
| E1 | app-link-contract | eco/base | todo |
| E2 | AI keys once (Strongroom) | eco/strongroom + readers | todo (needs E1; owner decision) |
| E3 | Share targets | eco/nexus, eco/design-editor, eco/deputy | todo (needs E1) |
| E4 | Store health hub | eco/store | todo (needs E1) |
| C1 | Clipboard smart actions + phase 1 | eco/clipboard | todo |
| C2 | Deputy repeating tasks | eco/deputy | todo |
| C3 | TunnelWall (firewall already on main) | eco/tunnelwall | todo |
| C4 | HomeNet | eco/homenet | todo |
| C5 | Strongroom health report | eco/strongroom | todo |
| C6 | Halo progress ring | eco/halo | in progress |
| C7 | Design Editor brand kit from image | eco/design-editor | todo |
| C8 | Nexus offline OCR (on main; verify, audit, fill gaps) | eco/nexus | todo |
| C9 | autonomous-browsing dry run | eco/autonomous-browsing | todo |
| V1-V5 | Vitals in Inflow | eco/inflow | todo |
| M1-M5 | Minutes in Nexus | eco/nexus | todo |
| B1-B6 | Cross-app wave 3 | various | todo |

## Open owner decisions (collect here, ask once at the end)

1. Strongroom holds the shared AI keys (E2): the prompt says yes, but AI hub (#66, on main) already owns a Keystore key ring for Gemini and Groq with a signature-guarded bound service. (my call, pending owner) E2 will build on the AI hub, NOT duplicate a key store in Strongroom, unless the owner says Strongroom must hold them. Needs owner confirmation.
2. Health data to Ask AI or Autopilot (V4): default off.
3. TunnelWall auto-connect on untrusted Wi-Fi (C3): default off.
4. Where the Shields switch lives (B4): (my call, to write down).
5. Repeating Deputy tasks that include payments (C2): default no; gate always stops them.

## File map

- Ledger: `docs/handoffs/ecosystem.md` (this file; main session writes it).
- Phase workspaces: `/Users/outsentia/Documents/apps-hub-wt/eco-work/<phase>/` (briefs, progress.md, locks, shared-files.txt). Outside the repo.

## Session log

- 2026-11-23: session interrupted; five agents resumed. F4 done. C6 started.
- 2026-11-23: recon done (Reuse table). F-base and E1 phase agents dispatched.
- 2026-11-23: start-up read, fetched origin, created `eco/base` and eleven app worktrees, installed deps, baseline gates green (above).

## Current state + next step

State: F-base and E1 phase agents running on eco/base; F4, F5, F6 workers dispatched. Next: collect reports, then F2 store side (eco/store), then Wave 2.
