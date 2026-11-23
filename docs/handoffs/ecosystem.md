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

## Reuse table (item 4 of start-up)

(pending recon)

## Work items and status

Status key: todo / in progress / built / gated / reviewed / not run.

| Id | Item | Branch | Status |
|---|---|---|---|
| F1 | Release guard | eco/base | todo |
| F2 | Rollback | eco/base + eco/store | todo |
| F3 | Docs drift | eco/base | todo |
| F4 | Halo 0.5.1 minors | eco/halo | todo |
| F5 | Deputy reliability | eco/deputy | todo |
| F6 | Nexus shortcuts | eco/nexus | todo |
| E1 | app-link-contract | eco/base | todo |
| E2 | AI keys once (Strongroom) | eco/strongroom + readers | todo (needs E1; owner decision) |
| E3 | Share targets | eco/nexus, eco/design-editor, eco/deputy | todo (needs E1) |
| E4 | Store health hub | eco/store | todo (needs E1) |
| C1 | Clipboard smart actions + phase 1 | eco/clipboard | todo |
| C2 | Deputy repeating tasks | eco/deputy | todo |
| C3 | TunnelWall | eco/tunnelwall | todo |
| C4 | HomeNet | eco/homenet | todo |
| C5 | Strongroom health report | eco/strongroom | todo |
| C6 | Halo progress ring | eco/halo | todo |
| C7 | Design Editor brand kit from image | eco/design-editor | todo |
| C8 | Nexus offline OCR | eco/nexus | todo |
| C9 | autonomous-browsing dry run | eco/autonomous-browsing | todo |
| V1-V5 | Vitals in Inflow | eco/inflow | todo |
| M1-M5 | Minutes in Nexus | eco/nexus | todo |
| B1-B6 | Cross-app wave 3 | various | todo |

## Open owner decisions (collect here, ask once at the end)

1. Strongroom holds the shared AI keys (E2): (my call) yes, separate Keystore-wrapped store, allowed per app. Needs owner confirmation.
2. Health data to Ask AI or Autopilot (V4): default off.
3. TunnelWall auto-connect on untrusted Wi-Fi (C3): default off.
4. Where the Shields switch lives (B4): (my call, to write down).
5. Repeating Deputy tasks that include payments (C2): default no; gate always stops them.

## File map

- Ledger: `docs/handoffs/ecosystem.md` (this file; main session writes it).
- Phase workspaces: `/Users/outsentia/Documents/apps-hub-wt/eco-work/<phase>/` (briefs, progress.md, locks, shared-files.txt). Outside the repo.

## Session log

- 2026-11-23: start-up read, fetched origin, created `eco/base` and eleven app worktrees, installed deps, baseline gates green (above).

## Current state + next step

State: worktrees ready, baseline recorded. Next: record recon in "Reuse table", then dispatch the Wave 1 phase agents (F1+F2+F3, E1, F4, F5, F6), then F2 store side.
