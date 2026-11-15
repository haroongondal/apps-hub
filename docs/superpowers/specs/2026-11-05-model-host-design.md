# Model Host: on-phone AI models for Deputy, photos and scans

Status: design, 2026-11-05. Working name "Model Host" (my placeholder; the owner
can rename it). Progress: `docs/handoffs/model-host.md`.

## 1. Intent and why

The owner wants three kinds of model running **on the Redmi Note 14 Pro itself**:

- a **Jev-style decision model** that picks one option from a list (the "System
  One" idea from TypeSafe's Jev),
- a **small image model** that reads screens, photos and documents,
- a **small model that thinks** before answering.

Why (owner, 2026-11-05, all four): **privacy** (screens and messages stay on the
phone), **no cost or rate limits** (no API bills, no Groq 8K-TPM waits),
**works offline**, and **faster replies**.

Jev itself can't run on the phone. It's a hosted API
(`POST https://api.typesafe.ai/v1/systemone`), and its weights aren't public
(`docs/handoffs/deputy.md`, "Jev" note, 2026-10-29). We copy its request shape
and how it works, and run an open model behind it.

## 2. Decisions the owner made (2026-11-05)

| Question | Answer |
|---|---|
| Why local | Privacy, no cost or limits, offline, faster (all four) |
| Where the models live | **A separate app** that hosts the models; Deputy and other `com.haroon.*` apps call it |
| What the image model does | Read Deputy's screens, process photos, scan documents (OCR), and decision making |
| When local can't do it | **Fall back to the cloud** (Gemini or Groq) |
| Playback (three jobs, one shared model, "faster" is doubtful on this chip) | "Nothing is wrong, go ahead" |
| What the Picker may tap without the Thinker | **Anything.** The Thinker's `irreversible` flag on the sub-goal covers every Picker step under it, along with the gate's existing verb rules |
| Screens recorded for Phase 0 | Screen text and screenshots from **Settings, Clock, Play Store and the Store only**. No chats and no bank apps. Kept in the session's scratch folder, **never committed** |
| Languages | **English only for v1** |

## 3. Goals

1. **G1.** A new Android app, `apps/model-host` (`com.haroon.modelhost`, Store
   release id `model-host`), that downloads, stores, loads and runs small open
   models on the phone's CPU.
2. **G2.** It serves three jobs from **one main model**, with the Picker on a
   small decision model (§7.2):
   - **Picker** (Jev-style): it gets a state and named questions, each with
     options, and returns a probability for every option. It never generates
     free text.
   - **Eyes:** it takes images (screenshots, photos, document pages) as chat
     input.
   - **Thinker:** chat with thinking turned on, for harder steps. *(My call:
     v1 never swaps checkpoints. A model with a built-in thinking switch wins
     Phase 0 if its speed is close to the others. Without one, the Thinker is
     the same model told to reason step by step before its tool call. Qwen3-VL
     ships Instruct and Thinking as separate files, so it counts as having no
     switch.)*
3. **G3.** Other `com.haroon.*` apps call it through an Android bound service
   that only apps signed with the owner's release key can use.
4. **G4.** Deputy uses it first and falls back to its configured cloud
   provider, one step at a time, whenever the local model fails, times out or is
   busy.
5. **G5.** Model Host has its own "Try" screen, where you share or pick a photo
   and then describe it, ask about it, or read its text. This covers "process my
   photos" and "scan documents" in v1.
6. **G6.** Real numbers from the owner's phone decide which model ships and which
   jobs run locally. Nothing is promised before Phase 0 has measured it.

## 4. Non-goals (v1)

- iOS, or any other phone. The work is tuned to this phone.
- Generative photo editing (inpainting, restyling). This chip can't do it in
  useful time, and Design Editor already handles edits. *(my call)*
- Sorting or indexing the whole gallery for search. That's a later phase
  (overnight, while charging). *(my call)*
- Replacing Tesseract in the PDF app's Scan. Scan keeps Tesseract. Calling Model
  Host from Scan ("read with AI") is a later phase. *(my call)*
- Reading Urdu, Arabic or any language other than English. v1 is English only
  (owner). Phase 0 doesn't test other languages.
- Training or fine-tuning on the phone.
- Running two large models at once. A small decision model (under 500 MB) may
  stay loaded beside the main model if Phase 0 shows there's room.
- Model Host calling any cloud API. Fallback is the caller's job, so Model Host
  holds no API keys. *(my call)*

## 5. Anti-goals (failure even if it "works")

- **The phone becomes unusable.** WhatsApp or the app Deputy is driving gets
  killed for memory mid-task, the phone overheats, or the battery drains in the
  background.
- **The local model gets around Deputy's approval gate.** The gate is native
  Kotlin and checks every action, whichever model chose it. Model Host changes
  nothing about the gate.
- **Any app other than the owner's can use the models or see what's sent to
  them.**
- **Content leaves the phone without the owner's say-so.** The only cloud path
  is Deputy's existing provider, which the owner already configured. Model Host
  uses the network only to download models, and only when the owner taps.
- **Deputy gets slower or less reliable than it is today** with no way to turn
  local off.

## 6. Constraints

- **Phone:** Redmi Note 14 Pro **4G**, 8 GB LPDDR4X, MediaTek Helio
  G100-Ultra (2x A76 @2.2 GHz + 6x A55), Mali-G57 MC2, UFS 2.2. Xiaomi
  "extended RAM" is swap on storage. HyperOS kills background apps unless
  Autostart is on and battery saver is set to "No restrictions"
  (`docs/handoffs/deputy.md`, "User's phone"; memory
  `hyperos-accessibility-setup`).
- **Memory budget:** after HyperOS and the foreground app, assume about 2–2.5 GB
  for Model Host. One quantised model of about 2B parameters (around 1–1.5 GB
  on disk) is the most it can hold. This is my estimate. Phase 0 measured
  (2026-11-06, launcher in front): MemAvailable is 4.3–4.6 GB. Peaks:
  InternVL3-1B 1.7 GB, Kev-0.8B 2.8 GB (4.1 GB without `-c`), Qwen3-VL-2B
  4.0 GB. Qwen3-VL and Kev together leave 0.9 GB. So only InternVL3-1B fits
  the 2–2.5 GB budget.
- **Repo rules (AGENTS.md):** Expo SDK 54 / RN 0.81.5, `@apps-hub/ui` for all UI
  (this needs a new brand key; choose its hue together with the launcher
  icon), native code in an Expo local module, Kotlin owns the logic and RN only
  renders (as in Deputy and Strongroom), `node --test` for TS, Gradle JVM tests
  for Kotlin, no telemetry.
- **Licences:** use FOSS only and no Google services. This matches the PDF Scan
  PRD, which excludes ML Kit, Play services and LiteRT 2.x. Runtime:
  **llama.cpp** (MIT). Models: prefer Apache-2.0 or MIT weights. Check each
  model's licence before adding it.
- **Distribution:** private Store only, signed with the shared release key.
  Install on the phone through the Store, never `adb install` (memory
  `install-via-store-only`). Register the app in `tools/release/src/apps.ts`.
- **Binder:** one transaction is capped at about 1 MB, and a screenshot alone can
  pass that. Send payloads through `ParcelFileDescriptor` pipes or shared memory.
- **Deputy's latest code is on branch `deputy-speed` (0.2.4)**, which isn't
  merged into `main` (0.2.3). Deputy work starts from whichever branch holds
  the installed version (memory `verify-branch-before-phone-build`).

## 7. The shape

### 7.1 Model Host app

```
apps/model-host/
  modules/model-host/android/
    core/      pure Kotlin: request parsing (chat + decide), option scoring maths,
               memory/idle policy, download + checksum policy. JVM-tested
               against a fake Engine port.
    android/   the llama.cpp engine via JNI (NDK/CMake, llama.cpp pinned to one
               release tag, with libmtmd for images), the bound service, the
               foreground service while a model is loaded, the downloader.
  src/         RN screens rendered from Kotlin state.
```

**Engine, first try** *(my call, decided in the Phase 1 plan)*: rather than
writing JNI against libllama, ship llama.cpp's own `llama-server` binary in
`jniLibs` and run it as a child process from `nativeLibraryDir`. It listens on
`127.0.0.1` on a random port, with a random `--api-key` that only Model
Host's process holds. It already provides chat completions with tools
(`--jinja`), images (`--mmproj`), `/v1/systemone`, prompt caching and loading
and unloading models. Model Host's bound service forwards each call to it.
Phase 0 runs the same binary on the phone over adb, which already shows it
runs there. Fall back to JNI only if the child process doesn't work in the
app.

**Screens** (RN, `@apps-hub/ui`):
- **Models:** each candidate model with its size, licence and download/remove
  buttons. It also shows which one is active, a "Test speed" button that reports
  load time, words per second and the memory used, and the free storage and RAM.
- **Try:** pick a photo or receive one from the share sheet. Then "Describe",
  "Ask" (type a question, with "Think first" on or off) or "Read text". The
  answer streams in. Nothing is saved.
- **Activity:** the last 50 calls. Each row shows the calling app, the job
  (Picker, Eyes or Thinker), how long it took, and the result (ok, busy, low
  memory or failed). It shows **no content**.

**Engine rules:**
- Load the model on the first request and unload it after 5 minutes idle
  *(my call)*, or as soon as `onTrimMemory` reports pressure.
- Keep a foreground service with a notification ("Model loaded · Unload") while
  a model is in memory, so HyperOS doesn't kill it mid-answer.
- Run one request at a time. A second caller gets `busy` immediately and doesn't
  wait in a queue, so Deputy falls back at once.
- Refuse to load when free RAM is under a threshold set in Phase 0. The answer
  is `low_memory`, so the caller falls back.
- Use the thread count and CPU flags Phase 0 measures as fastest. The A76 cores
  support `dotprod`. Whether 2, 4 or 8 threads is fastest isn't known yet.
- Cache the prompt prefix between calls (llama.cpp's KV cache), so Deputy's
  fixed system prompt and tool list are processed only once per loaded session.

**Model files:**
- Download from Hugging Face only when the owner taps, over https.
- Check each file against a SHA-256 hash written into the app. Reject a file
  that doesn't match.
- Store them in app-private storage, never inside the APK.

### 7.2 The API other apps call

This is an exported bound service guarded by a custom permission,
`com.haroon.permission.USE_MODELS`, with `protectionLevel="signature"`. Only
apps signed with the owner's release key can bind.

| Call | Input | Output |
|---|---|---|
| `status()` | — | Installed models, loaded model, free RAM, busy flag |
| `chat(json)` | The part of OpenAI chat-completions that Deputy already sends: `messages` (text plus `image_url` data URIs), `tools`, `tool_choice: "required"`, `reasoning_effort` (`none` turns thinking off; anything else turns it on), `max_tokens` | Chat-completions response JSON: `choices[0].message` with `tool_calls`, plus `usage` and a `timings` block (load, prefill, image, decode in ms) |
| `decide(json)` | Jev System One shape: `state` (text), `questions` (named, each with `instructions` and `choices` keyed by option, up to 255) | `answers`: one probability per option for each question, and `timings` |
| `cancel()` | — | Stops the request in flight |

Errors come back as a code plus plain words: `not_installed`, `busy`,
`low_memory`, `timeout`, `bad_request`, `failed`. Every code tells the caller to
fall back.

**How `decide` scores options** (found 2026-11-05): llama.cpp's server has
had a TypeSafe-compatible `POST /v1/systemone` route since 2026-10-02 (PR
#29818, present in tag `b11803`). It serves small Apache-2.0 decision models
that return a probability for every option plus a `confidence`: Julia-1
(168 MB Q8_0), Laya (449 MB Q8_0, up to 255 options) and Kev-0.8B (812 MB
Q8_0). `decide` passes the request through to that route, which is Jev's own
request shape. Phase 0 picks the model. Logit scoring on the main model (the
"SemIf" technique) is the fallback, used only if no decision model passes
Phase 0.

Why `chat` copies OpenAI's JSON: Deputy already builds and parses exactly that
(`ProviderJson` in `deputy-agent/core/Provider.kt`), so only the transport
changes.

### 7.3 Deputy changes

- **`ModelHostProvider : LlmProvider`** sends `ProviderJson.request(...)` over
  the binder and parses the reply with Deputy's existing parser.
- **`FallbackProvider(local, cloud) : LlmProvider`** tries `local` and uses
  `cloud` for that step on any error code, a timeout (a per-step budget set in
  Phase 0), or a reply with no valid tool call. It records which brain answered.
- **Screenshots** *(my call)*: the phone model gets Deputy's screenshots
  whenever Deputy takes one, because reading the screen is one of the owner's
  goals. When the fallback cloud model reads no images (Groq's GPT-OSS),
  `FallbackProvider` sends that step without the image parts. It replaces each
  image with a one-line note ("screenshot not shown") and leaves the text
  alone. Both brains get the same tool list: `tap_at` stays tied to the cloud
  model's image support, as it is today, so the history never holds a call the
  fallback can't accept.
- **Settings:** add a "Use phone models first" switch (off by default until the
  owner turns it on) and show Model Host's status ("Installed · Qwen… · ready" or
  "Not installed"). The cloud provider stays as it is and acts as the fallback.
- **History:** each step shows "on phone" or "cloud", with its time.
- **Picker fast path (Phase 3):** after a Thinker reply that names a short
  sub-goal, the next steps first call `decide`. Its state is the task, the
  sub-goal and the screen; its options are the numbered on-screen elements plus
  "sub-goal done" and "not sure". When the top option scores at or above a
  threshold (set from Phase 0 and the eval runs), Deputy acts on it. Below the
  threshold, or on "not sure", the step goes to the Thinker. The approval gate
  checks every action as it does today. The Picker may tap any element (owner,
  2026-11-05). The Thinker's `irreversible` flag on the sub-goal carries over to
  every Picker step under that sub-goal, so a flagged sub-goal still asks for
  approval on each irreversible tap. A sub-goal without the flag relies only on
  the gate's verb rules. This follows the Jev-Mobile split, where
  a VLM sets the goal and Jev picks the element.

### 7.4 Where each job runs (decided by Phase 0)

| Job | Runs locally if Phase 0 shows *(thresholds are my calls)* | Otherwise | Phase 0 result (2026-11-06) |
|---|---|---|---|
| Picker (`decide`, ~60 options, text only) | ≤ 2 s | Deputy skips the fast path | **No-go:** best is Kev-0.8B, 12/20 right (the bar is 16/20) in 8.8 s median |
| Deputy step (`chat` with screenshot, thinking off) | ≤ 15 s | Deputy calls the cloud straight away; the switch says why | **Cloud:** 191–280 s with a 720 px screenshot. Text-only steps take 2.4–12 s, but get only 3–8 of 17 taps right |
| Thinker (thinking on) | ≤ 30 s | Cloud | **Cloud:** InternVL3-1B told to reason estimates ≈ 16 s (it passes on speed) but taps the right element 3/17 times (no-go on quality, my call). Qwen3-VL ≈ 42 s and Gemma 4 E2B ≥ 73 s (estimates) |
| Try screen: describe or read a photo | ≤ 60 s | Still local, with a progress bar (owner-triggered, no hurry) | **Local with a progress bar:** image encode 74–151 s |

Figures are in `docs/handoffs/model-host.md`, under "Phase 0 results".

## 8. Phases

0. **Measure on the phone (spike, throwaway).** Push llama.cpp's `llama-bench`
   and `llama-mtmd-cli` (built for arm64 with the NDK) to `/data/local/tmp`
   over adb, and run them there. This installs no app; ask the owner before
   using adb on the phone (memory `phone-adb-testing-tips`). Candidates, all
   Apache-2.0 and checked on Hugging Face on 2026-11-05:
   - Main models:
     - Qwen3-VL-2B-Instruct Q4_K_M (1107 MB, plus a 445 MB mmproj)
     - SmolVLM2-2.2B-Instruct Q4_K_M (1113 MB, plus 593 MB)
     - InternVL3-1B-Instruct Q8_0 (675 MB, plus 333 MB)
     - Gemma 4 E2B Q4_0 (2841 MB, plus 557 MB). It's the only one with a
       thinking switch and is probably over budget.
   - Decision models: Julia-1, Laya, Kev-0.8B (see §7.2).

   Result (2026-11-06; tables in the handoff): every image model takes
   2–4 min per screenshot even at Deputy's 720 px, so screenshot reading isn't
   usable on this phone. InternVL3-1B Q8_0 is the only main model inside the
   memory budget. Qwen3-VL needs `-fa on` to survive the image encode. No
   decision model reaches 16/20 (Kev 12, Julia-1 3, Laya 1). Two threads
   decode fastest on every model.

   Measure load time, peak RAM, prefill speed at 512 and 2048 tokens, decode
   speed, the image-encode time for one 1080×2400 screenshot, the thread count,
   and the slowdown after 5 minutes (heat). Also measure the quality of
   `decide` on 20 recorded screens with known right answers. Record them
   only from Settings, Clock, Play Store and the Store. Take each screenshot
   with `adb exec-out screencap`, and write its numbered element list by hand
   in Deputy's `TreeDump` line format. Don't use `uiautomator dump`, because it
   can knock out the phone's accessibility services (memory
   `phone-adb-testing-tips`). Keep the files in the session scratch folder and
   never commit them. Also measure a Deputy step both with and without its
   screenshot. Output: a table in the handoff, the chosen models, and a go or
   no-go for each job in §7.4.
1. **Model Host app.** Engine, model download and checksum, the Models and Try
   screens, the foreground service and idle unload, and a Store release.
2. **API and Deputy fallback.** Start by checking, with Store builds, that
   Model Host can start its foreground service when Deputy binds to it from
   the background. Android 12+ limits and HyperOS's start blocking may stop
   it, and adb installs are ruled out (memory `install-via-store-only`). If it
   can't, change §7.1 before building on it. Then: the bound service, the signature permission,
   `chat`, `status` and `cancel`, `ModelHostProvider` and `FallbackProvider`,
   the Settings switch, and History labels. Deputy and Model Host get Store
   releases.
3. **Picker fast path.** `decide` in Model Host, then Deputy's sub-goal and
   Picker loop, measured with Deputy's EVAL runs (`docs/deputy/EVAL.md`) as
   local against cloud: steps, time and success.
4. **Later (not v1):** gallery indexing and search, "Read with AI" in the PDF
   app's Scan, and a second model when the phone has room.

## 9. Testing

- **Kotlin `core/`, Gradle JVM tests against a fake Engine:** chat and decide
  request validation, conversion from option scores to probabilities, the
  fallback policy (each error code, timeout, missing tool call), idle unload and
  low-memory refusal, and the checksum check.
- **Deputy:** JVM tests for `FallbackProvider`. Each error code sends that step
  to the cloud, a good local reply never reaches the cloud, and the gate still
  runs on local actions.
- **On the phone:** the Phase 0 table, then the release checks (Try screen
  answers offline in airplane mode; Deputy runs one EVAL task with phone models
  first, then with Model Host removed, and both finish).
- The native gate for the new app joins AGENTS.md's Verification Commands:
  `:model-host:testDebugUnitTest :app:assembleDebug`.

## 10. Risks

- **Speed (high).** Groq answers in under 1 s. A 2B model on two A76 cores may
  take tens of seconds per Deputy step once a screenshot is included. If Phase 0
  shows this, local Deputy steps are a no-go. Model Host still delivers privacy
  and offline use for photos and scans, and Picker may still pay off. The owner
  heard this doubt in the playback.
- **Quality.** 2B models call tools less reliably than Gemini Flash-Lite.
  Fallback covers failures, but a reply that is valid and wrong isn't caught.
  The approval gate still guards irreversible steps.
- **Picker and the gate (owner accepted).** If the Thinker misses the
  `irreversible` flag on a sub-goal, an icon-only Send button or a non-English
  label that the Picker taps goes through without asking (SPEC §8.4's known
  gap). Phase 3's eval should count these cases.
- **Memory and heat.** Running a model next to WhatsApp may force kills. Idle
  unload, the low-memory refusal and `onTrimMemory` limit this, and Phase 0
  measures it.
- **Build cost.** Building llama.cpp with the NDK adds C++ to the Android
  build. Pin one release tag and update it on purpose.
- **Model licences.** Some small models (Gemma) have their own terms. Check each
  one before listing it in the app.

## 11. Left to the builder

The JNI surface and threading, the exact llama.cpp tag and CMake flags, the AIDL
or Messenger choice, the pipe or shared-memory transport, the RN layout within
`@apps-hub/ui`, the downloader (resume, progress), the wording of the
notification and errors (sentence case, saying what happened and how to fix it),
and the brand hue together with the icon.
