# Model Host Phase 0 (measure on the phone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure candidate models on the owner's Redmi Note 14 Pro 4G and decide
which main model and which decision model Model Host ships, and which jobs run
on the phone.

**Architecture:** Build llama.cpp `b11803` for arm64 and run its own binaries
(`llama-bench`, `llama-mtmd-cli`, `llama-server`) from `/data/local/tmp/mb` over
adb. A small TS tool on the Mac sends Picker requests (`/v1/systemone`) and
Deputy-step requests (`/v1/chat/completions`) to `llama-server` through
`adb forward` and summarises the results. No app is installed.

**Tech Stack:** llama.cpp `b11803` (MIT), Android NDK 27.1.12297006, CMake
3.22.1 + Ninja from the Android SDK, Node 22 (`fetch`, `node --test`), bash,
adb.

**Spec:** `docs/superpowers/specs/2026-11-05-model-host-design.md` (§7.2 for
`decide`, §7.4 for the go/no-go limits, §8 Phase 0). Progress:
`docs/handoffs/model-host.md`.

## Global Constraints

- Work on branch `model-host` from `main`. Don't commit until the owner asks
  (handoff contract).
- Never `adb install` anything (memory `install-via-store-only`). Running
  binaries from `/data/local/tmp` over `adb shell` is allowed, but only after
  the owner says go for this session.
- Never run `uiautomator dump` on the phone (memory `phone-adb-testing-tips`).
- Before any tap or bench, run `adb shell dumpsys window | grep mCurrentFocus`
  and look for a "Deputy / Stop" pill. If the owner or Deputy is using the
  phone, stop and ask.
- Recorded screens only from Settings, Clock, Play Store and the Store.
  Screenshots and lists live in `$BENCH_DIR/screens/`. Never commit them.
- `BENCH_DIR` is `<this session's scratchpad>/model-bench`. Write the exact
  path into the handoff's session log.
- Model files only from these Hugging Face repos, each checked against the
  `lfs.sha256` the HF API reports:

  | Role | Repo | Files |
  |---|---|---|
  | main | `Qwen/Qwen3-VL-2B-Instruct-GGUF` | `Qwen3VL-2B-Instruct-Q4_K_M.gguf`, `mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf` |
  | main | `ggml-org/SmolVLM2-2.2B-Instruct-GGUF` | `SmolVLM2-2.2B-Instruct-Q4_K_M.gguf`, `mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf` |
  | main | `ggml-org/InternVL3-1B-Instruct-GGUF` | `InternVL3-1B-Instruct-Q8_0.gguf`, `mmproj-InternVL3-1B-Instruct-Q8_0.gguf` |
  | main | `ggml-org/gemma-4-E2B-it-GGUF` | `gemma-4-E2B-it-Q4_0.gguf`, `mmproj-gemma-4-E2B-it-Q8_0.gguf` |
  | decide | `ggml-org/Julia-1-GGUF` | `Julia-1-Q8_0.gguf` |
  | decide | `ggml-org/Laya-GGUF` | `Laya-Q8_0.gguf` |
  | decide | `ggml-org/Kev-0.8B-GGUF` | `Kev-0.8B-Q8_0.gguf` |

- Go/no-go limits (spec §7.4): Picker ≤ 2 s; Deputy step with screenshot ≤ 15
  s; Thinker ≤ 30 s; Try-screen photo ≤ 60 s. A decision model also needs
  **≥ 16/20 correct** to pass *(my call, close to Jev-Mobile's 79–84%)*.
- Every number in the results comes from command output on the phone. Never
  estimate a number and label it as measured. Mark derived figures
  "estimate".

## Review Focus

1. **The phone kills `llama-server` for memory mid-run.** The run must report
   "process died" for that model and must not record empty or zero numbers.
   Task 4 checks that the process is still alive after every request.
2. **A decision model refuses a screen with too many options** (its limit is
   below that screen's list). Record it as an error with the server's message,
   not as a wrong answer. Task 1's `pickerResult` test covers this.
3. **A main model answers a Deputy step in plain text instead of a tool call**
   (some chat templates lack tools). Count it as "no tool call" and don't
   crash. Task 1's `stepResult` test covers this.
4. **Phone storage runs out pushing Gemma (3.4 GB).** Check
   `df /data/local/tmp` before every push, push one main model at a time, and
   remove it when done (Task 4).
5. **The owner picks up the phone or starts Deputy during a bench.** Check
   focus and the Deputy pill before each model. If anything is in the
   foreground other than the launcher or the app being recorded, pause and
   ask (Tasks 3 and 4).

---

### Task 1: Bench tool (request builders and summaries)

**Files:**
- Create: `tools/model-bench/package.json` (name `@apps-hub/model-bench`,
  private, `"type": "module"`. Scripts: `"test": "node --test
  src/__tests__/bench.test.ts"`, `"typecheck": "tsc --noEmit"`. devDeps
  `@types/node ^22.10.0` and `typescript ~5.9.2`, as in `tools/store-api`.)
- Create: `tools/model-bench/tsconfig.json` (extends
  `../../packages/config/tsconfig.base.json`, `types: ["node"]`, includes
  `src`)
- Create: `tools/model-bench/src/bench.ts`
- Test: `tools/model-bench/src/__tests__/bench.test.ts`

**Interfaces:**
- Produces (all exported from `src/bench.ts`):
  - `interface Screen { id: string; app: string; task: string; subgoal: string; lines: string[]; answer: string; image?: string }`.
    `lines` are in Deputy's `TreeDump` format (`[12] text "Wi-Fi" clickable`).
    `answer` is an element index such as `"12"`, or `"done"` or `"unsure"`.
    `image` is a PNG path relative to `screens.json`.
  - `pickerRequest(s: Screen): object` builds the `/v1/systemone` body.
  - `pickerResult(s: Screen, body: unknown, ms: number): PickerResult` with
    `interface PickerResult { id: string; choice: string; top: number; ms: number; correct: boolean; error?: string }`.
  - `stepRequest(s: Screen, imageDataUrl: string | null): object` builds the
    `/v1/chat/completions` body.
  - `stepResult(s: Screen, body: unknown, ms: number): StepResult` with
    `interface StepResult { id: string; tool: string | null; promptMs: number; decodeMs: number; ms: number; valid: boolean; error?: string }`.
  - `summarise(rs: { ms: number; correct?: boolean; valid?: boolean }[]): { ok: number; total: number; medianMs: number; maxMs: number }`.
  - CLI: `node tools/model-bench/src/bench.ts picker|step <screens.json> [--url http://127.0.0.1:8080] [--image] [--max-tokens 128]`.
    It prints one markdown row per screen, then the summary row.

- [ ] **Step 0: Branch.** `git switch -c model-host` (from `main`).

- [ ] **Step 1: Write the failing tests** in
  `tools/model-bench/src/__tests__/bench.test.ts`. Use a fixture `Screen`
  with `lines: ['[3] text "Wi-Fi" clickable', '[7] text "Bluetooth" clickable off']`
  and `answer: '7'`:
  - `pickerRequest builds one choice question over the indexes`:
    `questions.next.type === 'choice'`, the keys of `criteria` are exactly
    `['3', '7', 'done', 'unsure']`, `criteria['7']` is the full line, and
    `state` contains the task, the sub-goal and both lines.
  - `pickerRequest rejects a line without an index`: a line `'Wi-Fi'` makes it
    throw `/line 1 has no \[n\] index/`.
  - `pickerResult marks the top choice`: for a body of
    `{ answers: { next: { choice: '7', probabilities: { '7': 0.9, '3': 0.1 } } } }`
    it returns `{ choice: '7', top: 0.9, correct: true }`.
  - `pickerResult records a server error, not a wrong answer`: for
    `{ error: { message: 'too many options' } }` it returns
    `{ choice: 'error', correct: false, error: 'too many options' }`.
  - `stepRequest attaches the screenshot only when given`: with `null`, the
    user message's `content` is a string; with `'data:image/png;base64,AA'`, it
    is an array holding an `image_url` part with that URL. Both have
    `tool_choice: 'required'`, `temperature: 0`, `max_tokens: 128`, and tools
    named exactly `tap`, `back` and `done`.
  - `stepResult accepts only a known tool with JSON arguments`: a reply with
    `tool_calls: [{ function: { name: 'tap', arguments: '{"index":7}' } }]`
    gives `valid: true, tool: 'tap'`. Plain text `content: 'Tap Bluetooth'` gives
    `valid: false, tool: null`. `timings.prompt_ms` and
    `timings.predicted_ms` are copied into `promptMs` and `decodeMs`.
  - `summarise counts and takes the median`: `ms` of `[5, 1, 3]` gives
    `medianMs: 3, maxMs: 5`, and `ok` counts `correct` or `valid` entries.

- [ ] **Step 2: Run them and see them fail.**
  Run: `node --test tools/model-bench/src/__tests__/bench.test.ts`
  Expected: FAIL, because `bench.ts` doesn't exist yet.

- [ ] **Step 3: Implement `src/bench.ts`.**
  - `state` text: `Task: …\nSub-goal: …\nScreen (<app>):\n<lines joined by \n>`.
  - The question's `instructions`: `"Which element should be tapped next to reach the sub-goal?"`
  - `criteria`: each line keyed by its index, plus
    `done: "The sub-goal is already reached"` and
    `unsure: "None of these elements fits"`.
  - The step system message, one paragraph:
    `"You operate an Android phone for the owner. Reply with exactly one tool call."`
    The user text is the same `state` text.
  - Tools: `tap({index: integer})`, `back({})`, `done({summary: string})`.
  - The CLI reads `screens.json`. With `--image` it inlines each screenshot as
    a `data:image/png;base64,` URL. It posts with `fetch` and times each call
    with `performance.now()`. A non-200 response becomes that row's `error`;
    don't throw.

- [ ] **Step 4: Run the tests and see them pass.**
  Run: `node --test tools/model-bench/src/__tests__/bench.test.ts`
  Expected: all 7 pass.

- [ ] **Step 5: Install and typecheck.**
  Run: `pnpm install` (adds the workspace package to the lockfile), then
  `pnpm --filter @apps-hub/model-bench typecheck`.
  Expected: no errors. `pnpm test` from the root also runs these tests.

### Task 2: Build llama.cpp for the phone and the Mac, fetch the models, smoke-test on the Mac

**Files:**
- Create: `tools/model-bench/build-llama.sh`
- Create: `tools/model-bench/fetch-models.sh`

**Interfaces:**
- Consumes: the Task 1 CLI.
- Produces:
  - `$BENCH_DIR/llama/android/bin/{llama-server,llama-bench,llama-mtmd-cli}`
    (arm64) and `$BENCH_DIR/llama/host/bin/…` (macOS).
  - `$BENCH_DIR/models/*.gguf`, each checked against its hash.

- [ ] **Step 1: Write `build-llama.sh <out-dir>`.**
  - `git clone --depth 1 --branch b11803 https://github.com/ggml-org/llama.cpp <out>/src`
  - Build twice with
    `/opt/homebrew/share/android-commandlinetools/cmake/3.22.1/bin/{cmake,ninja}`.
    Targets in both builds: `llama-server llama-bench llama-mtmd-cli`.
    - **host:** defaults, output in `<out>/host`.
    - **android:** NDK toolchain
      `/opt/homebrew/share/android-commandlinetools/ndk/27.1.12297006/build/cmake/android.toolchain.cmake`,
      `-DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-28 -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DLLAMA_CURL=OFF -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16`,
      output in `<out>/android`. The A76 has dotprod and fp16; the A55 runs
      the same ISA.
  - If cmake prints "Manually-specified variables were not used" for any of
    these flags, find that tag's spelling in `CMakeLists.txt` or
    `ggml/CMakeLists.txt` and use it.

- [ ] **Step 2: Run it and check the binaries.**
  Run: `bash tools/model-bench/build-llama.sh "$BENCH_DIR/llama"`, then
  `file "$BENCH_DIR"/llama/android/bin/llama-server` and
  `"$BENCH_DIR"/llama/host/bin/llama-server --version`.
  Expected:
  - `file` reports `ELF 64-bit LSB … ARM aarch64`.
  - `--version` prints a build line naming `b11803` or its commit.

- [ ] **Step 3: Write `fetch-models.sh <models-dir>`.**
  - It holds the repo and file table from Global Constraints.
  - For each file, `curl -fL --retry 3 -o` it from
    `https://huggingface.co/<repo>/resolve/main/<file>`.
  - Read the expected hash from
    `https://huggingface.co/api/models/<repo>?blobs=true`
    (`siblings[].lfs.sha256`, parsed with `node -e`).
  - Compare it with `shasum -a 256`. On a mismatch, delete the file and exit 1.
  - Skip a file that already exists and matches.

- [ ] **Step 4: Run it.**
  Run: `bash tools/model-bench/fetch-models.sh "$BENCH_DIR/models"`
  Expected: 13 files, each printed with its size and `sha256 ok`. That's about
  11 GB, so check free disk space on the Mac first.

- [ ] **Step 5: Smoke-test on the Mac.** These are made-up screens, not the
  phone's.
  - Write `$BENCH_DIR/smoke/screens.json` with two invented screens: a
    Settings list (Wi-Fi, Bluetooth, Display; answer Bluetooth), and the same
    list with answer `done`.
  - Generate one plain PNG for them (any image will do).
  - Then:
    - `host/bin/llama-server -m models/Julia-1-Q8_0.gguf --port 8080`, then
      `node tools/model-bench/src/bench.ts picker smoke/screens.json`.
    - Do the same for Laya (add `-ub 4096 -b 4096`, because Laya's prompt must
      fit one batch) and for Kev-0.8B.
    - `host/bin/llama-server -m models/Qwen3VL-2B-Instruct-Q4_K_M.gguf --mmproj models/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf --jinja --port 8080`,
      then `… step smoke/screens.json --image`.
  - Expected:
    - Every Picker row has a `choice` (or an `error` row that explains itself).
    - The step rows show a tool name or "no tool call".
    - The tool exits 0.
  - Record any model that rejects the request shape. Fix the request in
    `bench.ts` (with a test) only if the README for `b11803` shows the shape is
    wrong.

### Task 3: Owner's go, then record 20 screens

**Files:** `$BENCH_DIR/screens/NN.png` and `$BENCH_DIR/screens/screens.json`
(outside the repo, never committed).

- [ ] **Step 1: Ask the owner.** One message covering:
  - use of adb on the phone today,
  - leaving the phone idle and on the charger,
  - keeping Deputy idle,
  - letting you open Settings, Clock, Play Store and the Store with intents
    and taps.

  Wait for a yes.
- [ ] **Step 2: Connect.** Run `adb devices`, and if needed
  `adb kill-server; adb start-server` (memory `phone-adb-testing-tips`).
  Expected: exactly one device.
- [ ] **Step 3: Capture 20 screens.**
  - Cover 5 per app: Settings, Clock, Play Store (its home page and an app's
    page), and the owner's Store app (`com.haroon.store`). Include at least 3 screens whose
    right answer is `done`, and 2 where it's `unsure`.
  - Open each one with `am start` (for example
    `adb shell am start -a android.settings.SETTINGS`) or a tap. Check
    `mCurrentFocus` first.
  - Save with `adb exec-out screencap -p > NN.png`.
- [ ] **Step 4: Write `screens.json` by hand.**
  - Read each PNG.
  - Write its visible elements as `TreeDump` lines (`[i] text "Label"
    clickable`, `on`/`off` for switches), with indexes in reading order.
  - Add a realistic `task` and `subgoal` and the right `answer`.
  - Expected: 20 entries, and `node -e` parses each with `pickerRequest`
    without throwing.

### Task 4: Measure on the phone

**Files:** Create `tools/model-bench/phone.sh`. Every subcommand works in
`/data/local/tmp/mb` and exits 1 unless `adb devices` shows exactly one device.
- `push-bin` pushes the three android binaries and runs `chmod 755` on them.
- `push <file>` first checks `df /data/local/tmp` has the file's size plus 500
  MB free.
- `rm <file>`
- `serve <args…>` starts `llama-server --host 127.0.0.1 --port 8080 <args>` in
  the background (`nohup`), saves its pid, runs `adb forward tcp:8080
  tcp:8080`, waits until `/health` returns 200, and prints how many seconds
  that took. That figure is the model's load time.
- `alive` exits 1 if the saved pid is gone.
- `hwm` prints `VmHWM` from `/proc/<pid>/status`.
- `stop`
- `clean` removes `/data/local/tmp/mb` and runs `adb forward --remove-all`.

- [ ] **Step 1: Write `phone.sh`, then run `push-bin`.**
  Expected: `adb shell /data/local/tmp/mb/llama-server --version` prints the
  `b11803` build.
- [ ] **Step 2: Speed, for each main model, one at a time.** Push it, then run
  `adb shell /data/local/tmp/mb/llama-bench -m <model> -p 512,2048 -n 64 -t 2,4,8 -r 2 -o md`.
  Expected: a markdown table. Record pp512, pp2048 and tg64 for each thread
  count, and the best thread count.
- [ ] **Step 3: Image encode, for each main model.**
  - Run `llama-mtmd-cli -m <model> --mmproj <mmproj> --image <a pushed screenshot> -p "Describe this screen in one sentence." -n 32 -t <best>`.
  - Record the "image … encoded in N ms" line and the total time.
- [ ] **Step 4: RAM, for each main model.**
  - Run `serve -m <model> --mmproj <mmproj> --jinja -t <best> -c 8192`, then
    `bench.ts step screens.json --image` on screens 1–5.
  - After each request, run `alive`. Then run `hwm`, and also note
    `MemAvailable` from `/proc/meminfo` before and after.
  - Record the load time that `serve` printed, the peak RAM, and any "process
    died".
- [ ] **Step 5: Heat.** Use the model that's best so far.
  - Run `llama-bench -m <model> -p 0 -n 128 -t <best> -r 1` 10 times in a
    loop, back to back, for about 5 minutes. Record each tg128.
  - Slowdown = (first − last) / first.
- [ ] **Step 6: Picker, for each decision model.** For Laya, use
  `serve -m <model> -ub 4096 -b 4096 -t <best>`, then `bench.ts picker
  screens.json` (one warm-up call first, not counted). Record correct/20, the
  median and max ms, `hwm`, and each screen's `top` for right and wrong
  answers.
- [ ] **Step 7: Picker beside the main model.**
  - Take the best decision model that passes, and the best main model from
    Steps 2–4.
  - Start the main model's server, then the decision model's on port 8081,
    with `adb forward tcp:8081 tcp:8081` and `--url
    http://127.0.0.1:8081`.
  - Rerun screens 1–5 of Step 4 and Step 6, and record both `hwm` values,
    `MemAvailable` and any death. This decides whether the two can stay loaded
    together (spec §4).
- [ ] **Step 8: Deputy step, best 2 main models.** Run `bench.ts step
  screens.json` with and without `--image`. Record the median and max ms, and
  the tool calls that were valid out of 20.
- [ ] **Step 9: Thinker.**
  - Gemma 4 E2B, only if Step 4 shows it stays alive: rerun Step 8 (without
    `--image`) with `--reasoning-budget -1` on the server and
    `--max-tokens 1024` on the CLI. Record the time.
  - For the others: Thinker = text-only step time + 300 tokens ÷ tg64. Label
    it "estimate".
- [ ] **Step 10: Clean up.** Run `phone.sh clean`. Expected:
  `adb shell ls /data/local/tmp/mb` reports no such file.

### Task 5: Results and decisions

**Files:** Modify `docs/handoffs/model-host.md`, and the spec where the
numbers change it.

- [ ] **Step 1: Write the results** into the handoff under "Evidence", with the
  date and `b11803`, as three tables:
  - main models: load s, peak RAM MB, pp512, pp2048, tg64, best threads, image
    encode s, 5-min slowdown %;
  - decision models: correct/20, median ms, max ms, RAM MB, and whether it
    fits beside the main model;
  - Deputy step: with image s, text-only s, valid/20, Thinker s (measured or
    estimate).
- [ ] **Step 2: Decide.** Using §7.4's limits and the 16/20 bar:
  - name the main model, the decision model and the thread count;
  - give go or no-go for the Picker, the Deputy step, the Thinker and the Try
    screen;
  - say whether the two models stay loaded together.

  If no decision model passes, write that down and stop. Building logit
  scoring is the owner's call.
- [ ] **Step 3: Update the spec** wherever a number overrides a guess: the
  memory budget (§6), the candidates (§8), and §7.4 if a job changes sides.
- [ ] **Step 4: Update the handoff's** "Current state + exact next step" to
  "write the Phase 1 plan with <chosen models>". Then report the three tables
  and the decisions to the owner.
