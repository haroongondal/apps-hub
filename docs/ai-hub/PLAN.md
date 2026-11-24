# AI hub: plan for approval

Status: approved 2026-11-20 with every default recommendation below. Branch `ai-hub`, based on
`origin/main` (8b805458). Progress: `docs/handoffs/ai-hub.md`.

## What it is

One Android app, `com.haroon.aihub` (Store id `ai-hub`), that is the only place on the phone
where AI runs or is configured. Every other Store app asks the hub; none holds an API key or a
model of its own.

It has four parts:

1. **Providers:** Gemini and Groq, with several API keys per service and hand-over to the next
   key. The single source of truth for keys, models and limits.
2. **On-device ML:** the ONNX models that today live inside Design Editor (cut-out, upscale,
   photo search).
3. **Chat:** a chat screen in the hub, with sessions, image input and model choice.
4. **Harness:** agents with roles and tools, run by an orchestrator, where Store apps
   contribute the tools. The mobile counterpart of a desktop agent harness.

No local LLM. All language-model work goes to Gemini or Groq.

## Owner decisions already made

- 2026-11-20: the hub holds the API keys and is the single source of truth for Gemini and
  Groq, with multi-key fallback, chat, multi-agent support, and every Store app talking to AI
  through it. This reverses Model Host design §4 ("Model Host holds no API keys").
- 2026-11-20: no local LLM; on-device ML only (the Design Editor models).
- 2026-11-19 (memory): Gemini and Groq only. No OpenAI or Anthropic.

## What exists today (to consolidate, not rewrite)

| App | Code | Jobs | Keys |
|---|---|---|---|
| Deputy | `deputy-agent/core/Provider.kt` (`LlmProvider`, `OpenAiCompatProvider`), `KeyVault.kt` | Chat with tools and screenshots (agent loop) | Keystore-sealed vault |
| Inflow | `inflow-core/core/AiProvider.kt` (a trimmed copy of Deputy's) | Plain completion | Inflow settings |
| PDF Editor (Nexus) | `packages/knowledge-core/src/openai.ts`, `providers.ts` | Embed (Gemini), read image (Gemini), extract and answer (Groq), transcribe (Groq Whisper) | App settings |
| Design Editor (phone) | `src/editor/ai-keys.ts`, `ai.ts` | Design with AI (layout and text) | App settings |
| Design Editor (Mac) | `apps/design-editor/ai-keys.js` | Same, on the Mac | Mac settings |
| Design Editor (phone) | design-media `vision/`, `ClipSessions.kt`, `PhotoSearch.kt` | Cut-out, upscale, photo search (ONNX) | none |

All copies share one fallback rule: try the next key on 401, 403, Gemini's 400 for an unknown
key, or 429. Stop on anything else. A limit is reported before a refusal, since waiting can
fix it. The hub keeps that rule and is tested against the existing cases.

## Design

**Core in Kotlin.** Provider, key ring, queue, ML runtime and agent runtime are Kotlin in an
Expo local module, with pure logic in a `core/` package that runs as JVM tests. React Native
only renders (the same split as Deputy and Strongroom). The provider starts from Deputy's
`OpenAiCompatProvider`, since it already handles tools and images, plus Inflow's timeout rule
(a read timeout is never re-sent, because the model already billed it).

**Keys.** Sealed with a non-exportable Android Keystore key, as Deputy's `KeyVault.kt` does.
The service is detected from the key prefix (`gsk_` is Groq, `AIza` or `AQ.` is Gemini). Keys never
leave the hub, and callers see only "Groq key ending 1a2b".

**Jobs (contract v1):**

| Job | Default | Notes |
|---|---|---|
| `chat` | Groq `openai/gpt-oss-120b` | Messages, optional tools, streamed |
| `vision` | Gemini `gemini-3.5-flash-lite` | Chat with images |
| `embed` | Gemini `gemini-embedding-001` | Nexus re-embeds when the model tag changes |
| `transcribe` | Groq `whisper-large-v3-turbo` | Audio file descriptor in |
| `cutout`, `upscale` | MODNet, U2-Netp, Real-ESRGAN | On device |
| `searchPhotos`, `similarPhotos`, `indexPhotos` | CLIP | On device |

Models are hub settings, not caller choices, so one change applies to every app.

**IPC.** An AIDL bound service, exported, guarded by a `protectionLevel="signature"` permission
(Deputy's `com.haroon.permission.AUTOPILOT` pattern), so only apps signed with the shared
release key can bind. Every call carries `apiVersion` and the caller's package. Streaming uses
a one-way callback interface. Images and audio go as `ParcelFileDescriptor`, since one Binder
transaction is capped near 1 MB.

**Client package.** `packages/ai-hub-client`: a small Expo module that every caller app adds,
with the Kotlin binder client and a typed TS API. Kotlin callers (Deputy, Inflow) use its
Kotlin side directly. One client keeps the contract in one place.

**Queue and limits.** One queue per service: foreground calls before background ones, and
`retry-after` honoured. All apps share the keys, so one app's batch job can't starve the chat
screen.

**Per-app control.** The hub lists the apps that used AI, with their calls and tokens, and
an on/off switch per app. Strongroom is never allowed. Vault data does not leave Strongroom.

**Chat.** Sessions stored in the hub (SQLite via `expo-sqlite`, like OpenTunnel), streamed
replies, image attach, and a per-session model picker. Built from `@apps-hub/ui` with a new
`aihub` brand.

**Harness.** An agent is a role (system prompt), a model and a set of tools. The orchestrator
runs a planner that splits a goal into steps, workers that run steps, and a checker that
reviews the result. Steps are bounded (max turns, max tokens, wall-clock limit).
Tools come from two places:
- the hub's own (ML jobs, web fetch if allowed);
- tools that apps register over the client ("Nexus: search my documents", "Design Editor:
  make a design").

An app's tool runs inside that app, which keeps its own checks. Any tool that changes
something outside the hub (send, delete, pay, tap) needs the owner's confirmation on screen,
as Deputy's gate does today. Deputy's AccessibilityService and gate stay in Deputy. The
harness calls Deputy as a tool app, and never drives other apps itself. Long runs use a
foreground service, so HyperOS doesn't kill them.

## Decisions (approved 2026-11-20: the recommended option in each)

1. **No key fallback in apps.** Recommended: once an app moves to the hub, it drops its own
   keys and settings, and shows "Install AI hub" when the hub is missing. Alternative: keep
   the app's own keys as a fallback for one release.
2. **The Mac Design Editor** can't reach a phone app. Recommended: it keeps its own keys.
3. **Deputy.** Recommended: first Deputy uses the hub only as its provider, and its agent
   loop stays in Deputy. Later the harness calls Deputy as a tool app. Alternative: move
   Deputy's loop into the harness straight away.
4. **IPC.** Recommended: AIDL with a one-way callback for streaming. Alternative: `Messenger`,
   which is simpler but has no typed contract.
5. **Photo index and gallery permission** move to the hub. Design Editor drops
   `READ_MEDIA_IMAGES` for search.
6. **Names.** `com.haroon.aihub`, Store id `ai-hub`, brand `aihub`.
7. **Release.** Store only, shared key. Merge with `[skip ci]`, then `pnpm release ai-hub`
   locally, only on the owner's go.

## Phases

Each phase ends with its gates passing: `pnpm test`, `pnpm typecheck`, the hub's Gradle
`testDebugUnitTest` and `:app:assembleDebug`, plus each changed caller's gates.

- **P0:** the owner confirms the decisions above.
- **P1, hub and providers:** the app scaffold, Keystore key ring, the provider (chat, vision,
  embed, transcribe) with the shared fallback rule, the queue, keys and models settings, and
  the bound service with the signature permission. JVM tests port the existing fallback cases
  from all five copies.
- **P2, chat screen:** sessions, streaming, image attach, model picker.
- **P3, client and first callers:** `packages/ai-hub-client`, then move Inflow (smallest),
  Nexus, Design Editor (phone) and Deputy (provider only). Each move deletes that app's
  provider copy and key settings.
- **P4, on-device ML:** move cut-out, upscale and photo search out of Design Editor,
  including a one-time move of the existing photo index.
- **P5, harness:** agent definitions, orchestrator, tool registry over the client, the
  confirmation gate, run history in the chat screen, and the foreground service.
- **P6, release:** registration in `packages/store-manifest` and
  `tools/release/src/apps.ts`, then release on the owner's go. Earlier phases can ship as
  hub-only releases once P1 is done.

Phone tests only through the Store, on the owner's phone, with the coord device claim.
Never `adb install`, never an emulator.

## Risks

- **One point of failure.** If the hub is missing, killed or broken, every app loses AI.
  Mitigations: binding starts the service, and every caller shows a plain message.
- **Shared limits.** Groq's tokens-per-minute limit is now shared by every app. The queue and
  priorities are the answer, and the usage screen shows who used what.
- **Contract drift.** Apps update separately through the Store. `apiVersion` from day one, and
  the hub answers older versions for one release.
- **Privacy.** Content from every app goes to Gemini or Groq through one place. Per-app
  switches, the Strongroom block, and no logging of request bodies.
- **Memory.** Cut-out and upscale peak near 165 MB of Java heap, which is tight on a 192 MB
  limit. The separate process doesn't change that limit.
- **Scope.** This is six phases. Phases with more work than one session fits go through the
  phased-orchestration skill, with a handoff file at `docs/handoffs/ai-hub.md`.

## Out of scope for v1

iOS, the Mac app as a client, a local LLM, OpenAI or Anthropic, and cloud sync of chats.
