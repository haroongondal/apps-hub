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

## Session log

- 2026-11-20: design approved; worktree and branch `ai-hub` created from origin/main; P1 ledger
  and briefs written; P1 started.

## Current state + exact next step

P1 in progress. Read the ledger for which tasks are complete; dispatch the next ready task.
