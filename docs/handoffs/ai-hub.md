# Handoff: AI hub

## Resume prompt

Dated 2026-11-20. Work in `/Users/outsentia/Documents/apps-hub-wt/ai-hub` on branch `ai-hub`
(a worktree of `/Users/outsentia/Documents/apps-hub`, based on `origin/main` 8b805458). Read this
file completely first, then `docs/ai-hub/PLAN.md` (the approved design), then the P1 ledger
`.superpowers/sdd/ai-hub-p1/progress.md` (every `Task <N>: complete` line and every `Ruling:` line).
Trust the verified facts below and don't redo that work. Follow the handoff contract in
`~/.claude/CLAUDE.md`: update the session log and current state as milestones land, and at about
85% context finalize this file and print a new resume prompt instead of compacting. Execute
with `cd-engineering-tools:parallel-agents-coord` (section 0 loop with the ledger); use
`cd-engineering-tools:phased-orchestration` if a phase won't fit one context. Never use
`superpowers:subagent-driven-development`. Continue from "Current state + exact next step".

## Goal and fixed constraints

- A separate Android app `apps/ai-hub` (`com.haroon.aihub`, Store id `ai-hub`, brand `aihub`):
  single source of truth for Gemini and Groq (several keys per service, hand-over to the next
  key), a chat screen, a multi-agent harness, and the on-device ONNX models now in Design Editor.
  Every Store app talks to AI through it over a signature-protected AIDL bound service.
- No local LLM. Gemini and Groq only (no OpenAI, no Anthropic). Strongroom never calls the hub.
- Repo rules (AGENTS.md): Expo SDK 54 / RN 0.81.5, `@apps-hub/ui` for all UI, Kotlin owns logic
  and RN only renders, `node --test` for TS, Gradle JVM tests for Kotlin, F-Droid clean, no
  telemetry, erasable TypeScript, each package lists its test files by name.
- Commits: no `Co-Authored-By` or "Generated with" lines (owner memory overrides the harness).
  Commit only on this branch. Never push, merge or release without the owner's go.
- Phone: Store installs only, coord device claim, never an emulator, never `adb install`.

## Decisions made (with why)

- 2026-11-20, owner: approved PLAN.md with every default: apps drop their own keys after moving;
  the Mac Design Editor keeps its own keys; Deputy uses the hub as provider first (loop stays in
  Deputy); AIDL with one-way callbacks; photo index and gallery permission move to the hub; names
  `com.haroon.aihub` / `ai-hub` / `aihub`; release only on the owner's go.
- 2026-11-20, owner: hub holds the keys (reverses Model Host design §4).
- 2026-11-20, owner: no local LLM; only the Design Editor's ONNX models on device.
- 2026-11-24, ecosystem E2 (main session's call, owner to confirm; recorded in
  `docs/handoffs/ecosystem.md`): the hub keeps the keys (option A). Apps call `submit()`; no API
  hands a key to another app. Each app keeps its own key fields as a fallback when the hub is
  missing, refuses, has no key or speaks an older apiVersion. This differs from PLAN's "apps drop
  their own keys after moving"; the owner decides which stands.
- 2026-11-24, E2: unknown apps are denied by default. A same-signed app is served only after the
  owner turns it on (`switches[pkg] == true`). No app bound the hub before this, so nothing was
  grandfathered. A refused, undecided app is listed as pending (package and last time, at most
  20, one write per app per minute) so the owner can allow it.
- 2026-11-24, E2 (my call, owner decides if it stays): a per-call log in HubStore `call_log`
  (app, job, service, time; never prompt, reply or key; newest 200; Clear button), shown as
  "Recent requests".
- 2026-11-24, E2: apiVersion 2 adds embed `dimensions` (rounded up to 128, 256, 512, 768, 1536 or
  3072, sent to Gemini as `dimensions`) and transcribe `segments` (Whisper `verbose_json`, reply
  gets `segments: [{start, end, text}]`). Version 1 requests are unchanged. The AIDL is unchanged.
  P2 streaming, planned as "v2", becomes apiVersion 3.

## Evidence already verified (2026-11-20)

- Provider copies to consolidate, all on origin/main: Deputy `deputy-agent/core/Provider.kt`
  (`LlmProvider`, `OpenAiCompatProvider`, tools and images) and `android/KeyVault.kt` (Keystore
  AES-GCM); Inflow `inflow-core/core/AiProvider.kt` (trimmed copy, read timeout never re-sent);
  `packages/knowledge-core/src/openai.ts` + `providers.ts` (Nexus: embed, readImage, extract,
  answer, transcribe); Design Editor phone `src/editor/ai-keys.ts` + `ai.ts`; Mac
  `apps/design-editor/ai-keys.js`.
- Shared fallback rule in every copy: next key on 401, 403, Gemini 400 matching
  `API key not valid|API_KEY_INVALID`, or 429; stop on anything else; a limit is reported before
  a refusal. Keys: `gsk_` prefix is Groq, `AIza` is Gemini.
- Default models: Groq `openai/gpt-oss-120b` (chat), Gemini `gemini-3.5-flash-lite` (vision),
  `gemini-embedding-001` (embed), Groq `whisper-large-v3-turbo` (transcribe). Endpoints:
  `https://api.groq.com/openai/v1/`, `https://generativelanguage.googleapis.com/v1beta/openai/`.
- Signature-permission precedent: Deputy's `com.haroon.permission.AUTOPILOT`
  (`protectionLevel="signature"`) in `apps/deputy/modules/deputy-agent/android/src/main/AndroidManifest.xml`.
- Deputy is the template app: `App.tsx` + `index.ts`, module `modules/deputy-agent` with
  `core/` (pure, JVM-tested) and `android/`, committed `android/` prebuild, package.json scripts
  `prebuild`, `test`, `typecheck`. Module deps: okhttp 4.9.2, kotlinx-serialization-json 1.8.1,
  junit 4.13.2, kotlinx-coroutines-test 1.7.3.
- UI brands live in `packages/ui/src/tokens.ts` (`BrandKey` union and the brand table); run
  `pnpm --filter @apps-hub/ui build:css` after a change; its tests check staleness and WCAG AA.
- ONNX Runtime facts for P4: see `docs/ai-hub/PLAN.md` and memory `onnxruntime-android-telemetry`.

## File map

- `docs/ai-hub/PLAN.md`: approved design.
- `.superpowers/sdd/ai-hub-p1/`: P1 ledger, briefs, reports (not committed).
- `apps/ai-hub/`: the app (P1 creates it).
- `packages/ai-hub-client/`: the client (P3 first half): AIDL copy, Kotlin `AiHubClient`, TS
  `aiHub` API, shared fixture `fixtures/contract.json` (read by the hub's `ClientContractTest`).
  README has the error kinds and the fallback rule. No app uses it yet.

## Session log

- 2026-11-20: design approved; worktree and branch `ai-hub` created from origin/main; P1 ledger
  and briefs written; P1 started.
- 2026-11-20: P1 T1 (scaffold, brand aihub) dd937412; Transport contract 3f0d81f0; T3 (queue,
  caller policy, usage) 9d9dd1d1; T4 (key vault, store, transport) a7425871 + fix 682b6e79
  (vault never overwrites keys it can't open; clear() is the way out); T2 (providers, key
  hand-over, 42 tests) 84dfc98e. T5a (bound service, AIDL, worker) and T5b (module functions,
  screens) dispatched in parallel from 84dfc98e.
- 2026-11-20: P1 done. T5b screens 6a9f0b6c; T5a bound service, AIDL v1, caller check, worker
  259f4012. Wave review (no bypass of the caller check, keys or Strongroom block) and two
  automated security findings fixed in 84162c46, 41a91563, 15da0d61, then 4cab1dc0, 22e97cb4,
  1a748a04: embed replies as base64 float32 (max 8 texts); 8 requests per caller, 64 total;
  attachments regular files only (7 MB image, 25 MB audio), closed only by the thread reading
  them; key in use sticks; only never-connected requests are re-sent, no idle connection reuse;
  one KeyVault and HubStore per process. Final gates from a clean export of 1a748a04: pnpm test
  2463/0, typecheck clean, JVM 101/101, assembleDebug OK.

- 2026-11-23: merged origin/main into ai-hub (fa4f4a63; frozen install, ui 29/29, ai-hub 7/7,
  typecheck, JVM 101/101 + assembleDebug); pushed; PR #66 opened
  (https://github.com/haroongondal/apps-hub/pull/66). Release APK built (signed CN=Haroon Mukhtar,
  O=apps-hub); phone install waits in the coord queue.

- 2026-11-24 (eco/ai-hub, E2): default deny + pending list, per-call log and Recent requests,
  apiVersion 2 (embed dimensions, transcribe segments), `packages/ai-hub-client`. Gates: hub JVM
  tests and assembleDebug, ai-hub and ai-hub-client node tests and typecheck; client Kotlin
  compiled and tested inside the hub's Gradle build with an init script (see its README).
  Nothing run on a phone.

## Current state + exact next step

E2 (2026-11-24, branch eco/ai-hub): the client package exists and no app uses it yet. Next for P3:
wire the first caller (Inflow) to `ai-hub-client` with its own key as the fallback, after the
owner confirms option A, then the phone checks: a second app binds after the owner allows it; a
never-allowed app shows as pending; a differently signed app is refused; real Gemini and Groq
replies, including `dimensions` and `segments`.

Earlier state (P1):

P1 (hub and providers) is complete on `ai-hub` at 1a748a04. Nothing has run on a phone yet.
Deferred (ledger): linkToDeath on callbacks; request cap counts bytes while Binder carries UTF-16;
a FUSE proxy descriptor passes the regular-file check; a small failed oneway send surfaces as
DeadObjectException; VISION peaks near 35-40 MB per job (OOM is caught).

Next: P2 (chat screen: sessions in expo-sqlite, image attach, model picker, streaming, which adds
a streaming callback to the AIDL contract as v2). Start a P2 ledger at
`.superpowers/sdd/ai-hub-p2/progress.md` and follow the same loop. A Store release of the hub
needs the owner's go (PLAN P6), and the phone checks (a second app binding, a differently signed
app refused, real Gemini/Groq replies, cancel during a read) need a Store build first.
