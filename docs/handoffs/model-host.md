# Handoff: Model Host (on-phone AI models)

## Resume prompt

Dated 2026-11-06 (about 01:00). Work in `/Users/outsentia/Documents/apps-hub`
on branch `model-host`. Read `docs/handoffs/model-host.md` completely first,
especially "Phase 0 results" under Evidence and "Current state + exact next
step". Then read the executor ledger
`.superpowers/sdd/2026-11-05-model-host-phase-0/progress.md` (every `Ruling:`
line), and the design `docs/superpowers/specs/2026-11-05-model-host-design.md`
(§6, §7.4 and §8 now carry the measured numbers). Trust the verified facts and
the ledger. Phase 0 Tasks 1–5 are complete, so don't re-measure anything.

Follow the handoff contract in `~/.claude/CLAUDE.md`. Update the session log
and the current state as each step lands, and at about 85% context finalize
the handoff and print a new resume prompt instead of compacting. Keep using
superpowers:executing-plans with this ledger for the final whole-branch
review.

The phone is no longer needed (checked at 01:41: no llama-server, no
`/data/local/tmp/mb`, stay-on 0). If option C is picked, ask the owner, then
claim the phone with the coord plugin (`coord claim device:49kjmnuwonkffqzh`;
see CLAUDE.md). Use `ANDROID_SERIAL=49kjmnuwonkffqzh`, and run `guard.sh`
before each model. Never adb-install anything, and never run `uiautomator
dump`. Commit only when the owner asks. Leave the unrelated untracked files
alone (`apps/*/assets/icon-128.png`, `strongroom-extension-dist.zip`).
Continue from "Current state + exact next step".

## Goal and fixed constraints

- A separate Android app (`apps/model-host`, `com.haroon.modelhost`, Store only)
  that runs a Jev-style picker, a small vision model and a thinking model on the
  owner's Redmi Note 14 Pro 4G, and lends them to Deputy and other
  `com.haroon.*` apps. Cloud fallback stays in the caller (Deputy).
- The design doc holds the goals, non-goals, anti-goals and constraints.

## Decisions made (with why)

Owner, 2026-11-05: why local = privacy + no cost/limits + offline + faster;
separate app; the image model reads screens, photos, documents and helps decide;
fall back to cloud. The owner accepted the playback, including the doubt about
"faster". Builder-check answers (owner, 2026-11-05): the Picker may tap
anything, covered by the Thinker's sub-goal flag; Phase 0 screens come only
from Settings, Clock, Play Store and the Store, stay in scratch and are never
committed; v1 is English only. Everything marked "(my call)" in the design is
unconfirmed.

Owner, 2026-11-05: approved the design ("go ahead"), and then approved the
Phase 0 plan. They were told about the changes made after approval: `decide`
goes through llama.cpp's `/v1/systemone` with a small decision model next to
the main one; the engine's first try is `llama-server` as a child process; the
background-start check moved to Phase 2; screens come from screencap. The owner
didn't pick an execution method. I recommended Native (executing-plans), and
the resume prompt uses that because only Task 1 is real code and Tasks 3–5
need the owner and the phone.

## Evidence already verified (2026-11-05)

- Jev is hosted only (`api.typesafe.ai/v1/systemone`), and its weights aren't
  public (deputy handoff, Jev note; scriptbyai.com Jev alternatives page).
- Open Jev-style deciders exist: OpenJev-8B (Apache-2.0, pointer head, too big),
  Kev 0.8B–27B, Mapika Decider 2B (GGUF, ~1.3 GB Q4_K_M), GLiNER2.5-Decide 340M
  (encoder), jevos, and SemIf (logit scoring on any LM, MIT). These come from
  secondary pages and aren't checked against their repos.
- llama.cpp multimodal (`libmtmd`, MIT) has ready-made GGUFs for SmolVLM2-2.2B,
  InternVL3-1B/2B, Qwen2-VL-2B and Gemma 4 E2B (`docs/multimodal.md`). Qwen3-VL
  2B GGUFs are reported to exist but aren't on that page.
- No published llama.cpp numbers for the Helio G99/G100 were found. The MNN-LLM
  paper claims 8.6x faster prefill than llama.cpp on CPU, but those are the
  authors' own numbers on flagship phones.
- Deputy's model seam: `interface LlmProvider { suspend fun step(history, tools): ModelTurn }`
  and `ProviderJson.request(...)` in `deputy-agent/core/Provider.kt` (branch
  `deputy-speed`). `Settings.kt` requires `https://` base URLs.

- llama.cpp has had `POST /v1/systemone` (TypeSafe-compatible) since
  2026-10-02 (PR #29818, merged), and it's present in tag `b11803`
  (2026-10-21, pinned). It returns per-option `probabilities` and a
  `confidence`.
- Decision GGUFs (HF API, 2026-11-05), all Apache-2.0: Julia-1 Q8_0 168 MB,
  Laya Q8_0 449 MB, Kev-0.8B Q8_0 812 MB. Lev Q4_K_M is 3 GB, OpenJev is
  CC-BY-NC at 19 GB, and LiquidAI d1-2B is on the LFM licence. None of those
  three are candidates.
- Main GGUFs (HF API, 2026-11-05), all Apache-2.0: Qwen3-VL-2B-Instruct Q4_K_M
  1107 MB + mmproj Q8 445 MB; SmolVLM2-2.2B Q4_K_M 1113 + 593; InternVL3-1B
  Q8_0 675 + 333; Gemma 4 E2B Q4_0 2841 + 557.
- The Mac has NDK 27.1.12297006 and CMake 3.22.1 + Ninja under
  `/opt/homebrew/share/android-commandlinetools/`. Its adb is at
  `~/Library/Android/sdk/platform-tools/adb`.
- Don't use `uiautomator dump` on the phone (memory). Phase 0 screens come
  from `screencap`, with their element lists written by hand.

### Phase 0 results (phone, llama.cpp `b11803`, 2026-11-05/06)

Redmi Note 14 Pro 4G on USB, launcher in front. Battery temperature stayed at
30–36 °C. Every figure is from the phone unless it's marked "Mac". Images are
Deputy's real input: 720×1600 JPEG q70 (`SHOT_WIDTH = 720`). At the full
1080×2400, Qwen3-VL was killed and SmolVLM2 took 944 s. Main models run with
`-fa on`; without it, Qwen3-VL is killed while encoding the image.

**Main models** (t/s at 2 threads; the best figure at more threads is in
brackets)

| Model | Load s | Peak RAM MB | pp512 | pp2048 | tg64 | Best threads | Image encode s | 5-min slowdown |
|---|---|---|---|---|---|---|---|---|
| InternVL3-1B Q8_0 | 4.1 | 1720 | 126 (150 @8) | 95 (101 @4) | 23.8 | 2 | 151 | not measured |
| Qwen3-VL-2B Q4_K_M | 12.6 | 3955 | 28 (40 @8) | 23 (26 @8) | 10.3 | 2 | 148 | not measured |
| SmolVLM2-2.2B Q4_K_M | – | – | 24 (28 @8) | 19 (25 @8) | 8.4 | 2 | 130 | not measured |
| Gemma 4 E2B Q4_0 | – | – | 22 | 15 (17 @8) | 4.1 | 2 | 74 | not measured |

Decode falls 2–3× at 8 threads, because 6 of the 8 cores are A55s.

**Decision models** (`/v1/systemone`, 20 screens)

| Model | Correct /20 | Median ms | Max ms | RAM MB | Fits beside the main model |
|---|---|---|---|---|---|
| Kev-0.8B Q8_0 (`-t 2 -c 4096`) | 12 (0/4 "done") | 8814 | 15266 | 2800 | Beside Qwen3-VL: both stay alive, but MemAvailable drops to 897 MB, Picker median 14.6 s |
| Kev-0.8B at `-t 8` | 12 | 13922 | 22538 | – | – |
| Julia-1 Q8_0 (Mac) | 3 | 17 | 38 | – | not run on the phone |
| Laya Q8_0 (Mac) | 1 | 61 | 89 | – | not run on the phone |

Kev's real profile: right on **12 of 13** screens where an element is the
answer, and wrong on **all 7** screens whose answer is "done" or "unsure". On
6 of those 7 it tapped an element; on 15 it said "done". A gate at top ≥ 0.35
answers 12 of 20 and gets 10 right. But the 0.35 was picked on these same 20
screens, so it's in-sample. Both errors above the gate (08, 10) are taps on
screens where nothing should be tapped, so the gate doesn't catch Kev's
failure mode. Right answers also sit as low as 0.155 and 0.303. With no `-c`,
Kev peaks at 4.1 GB.

Kev per screen (phone, `-t 2 -c 4096`; ✓ = right):

| Screen | Answer | Kev | Top | ms | | Screen | Answer | Kev | Top | ms |
|---|---|---|---|---|---|---|---|---|---|---|
| 01 | 6 | 6 ✓ | 0.531 | 7252 | | 11 | 16 | 16 ✓ | 0.502 | 12359 |
| 02 | 2 | 2 ✓ | 0.355 | 3217 | | 12 | 11 | 11 ✓ | 0.155 | 15266 |
| 03 | done | 3 | 0.330 | 8679 | | 13 | 8 | 8 ✓ | 0.443 | 8949 |
| 04 | 8 | 8 ✓ | 0.353 | 5279 | | 14 | done | 3 | 0.244 | 12536 |
| 05 | 4 | unsure | 0.330 | 5791 | | 15 | unsure | done | 0.254 | 8404 |
| 06 | 13 | 13 ✓ | 0.303 | 12635 | | 16 | 5 | 5 ✓ | 0.373 | 11339 |
| 07 | 8 | 8 ✓ | 0.689 | 5570 | | 17 | 11 | 11 ✓ | 0.367 | 12002 |
| 08 | done | 6 | 0.442 | 4441 | | 18 | unsure | 8 | 0.222 | 12167 |
| 09 | 7 | 7 ✓ | 0.422 | 8230 | | 19 | 5 | 5 ✓ | 0.561 | 12716 |
| 10 | unsure | 2 | 0.451 | 2183 | | 20 | done | 1 | 0.292 | 10707 |

**Deputy step** (`chat` with tools, thinking off)

| Model | With image s | Text-only s, median (max) | Valid /20 | Right taps /17 | Thinker s |
|---|---|---|---|---|---|
| InternVL3-1B | 191 | 2.4 (4.0); rerun 3.1 (4.4) | 20 | 3 | ≈16 (estimate; no thinking switch) |
| Qwen3-VL-2B | 213 (280 beside Kev) | 9.4 (16.8); rerun 12.4 (19.0) | 20 | 8 | ≈42 (estimate) |
| SmolVLM2-2.2B | ≈181 (CLI total) | – | – | – | ≥36 + prefill (estimate) |
| Gemma 4 E2B | ≈125 (CLI total) | – | – | – | ≥73 + prefill (estimate) |

The "Right taps" column leaves out the 3 screens whose answer is "unsure",
because no tool means "unsure". On the same 17, Kev gets 12. Estimate =
text-only step + 300 tokens ÷ tg64.

**Decisions (Task 5, against §7.4 and the 16/20 bar)**

- Picker: **no-go.** No decision model passes. Kev gets 12/20 at 8.8 s
  (the bar is ≥ 16/20 and ≤ 2 s). Julia-1 and Laya fail on the Mac. Per the
  plan this stops here: logit scoring, or a confidence-gated Kev (option B),
  is the owner's call.
- Deputy step with a screenshot: **no-go** (191–280 s against ≤ 15 s). Cloud.
- Thinker: **no-go on quality (my call; the owner can overrule it).** Spec
  G2 lets a model without a thinking switch reason when told to. InternVL3-1B
  then estimates ≈ 16 s, which passes §7.4's ≤ 30 s on speed. But it tapped
  the right element on only 3 of 17 screens, and §7.4 has no quality bar.
  Qwen3-VL (≈ 42 s, estimate) and Gemma 4 E2B (≥ 73 s, estimate) fail on
  speed. Cloud.
- Try screen: **local, with a progress bar** (74–151 s to encode against
  ≤ 60 s, so the table's "otherwise" applies).
- Main model, if the Try screen is built: **InternVL3-1B Q8_0, 2 threads,
  `-fa on`.** It's the only one inside the memory budget (1.7 GB peak), it
  loads in 4 s and its caption was right.
- Two models loaded together: not needed (the Picker is no-go). It would fit
  with Qwen3-VL, but leaves only 0.9 GB free.

## File map

- Design: `docs/superpowers/specs/2026-11-05-model-host-design.md`
- Phase 0 plan: `docs/superpowers/plans/2026-11-05-model-host-phase-0.md`
- Phase 0 tool (to be created by Task 1): `tools/model-bench/`
- Deputy seam: `apps/deputy/modules/deputy-agent/android/src/main/java/expo/modules/deputyagent/core/Provider.kt`
- Store registration: `tools/release/src/apps.ts`
- UI brands: `packages/ui/src/tokens.ts` (`BrandKey`)

## Session log

- 2026-11-05: brainstormed with the owner, researched, and wrote the design.
  The builder check raised 5 questions: I settled 2 (Thinker without checkpoint
  swaps; screenshots stripped on a text-only fallback), and the owner answered 3.
- 2026-11-05: the owner approved the design. I found llama.cpp's `/v1/systemone`
  and the decision GGUFs, and changed the design to use them (flagged to the
  owner). Wrote the Phase 0 plan, and the owner approved it. Ended the session
  with a resume prompt for a fresh chat.

- 2026-11-05 (session 2): branch `model-host` created from `main`. Task 1
  done: `tools/model-bench` (bench.ts + 8 tests, all pass; full `pnpm test`
  green; typecheck clean; lockfile gained only the `tools/model-bench`
  importer). Nothing committed. `BENCH_DIR` for this session is
  `/private/tmp/claude-501/-Users-outsentia-Documents-apps-hub/d278ff1e-b5ef-48aa-9593-2183c7e262ac/scratchpad/model-bench`.
  Executor ledger (with rulings): `.superpowers/sdd/2026-11-05-model-host-phase-0/progress.md` (git-ignored).

- 2026-11-05 (session 2): Task 2 done on the Mac. `build-llama.sh` built
  `b11803` (= commit `a37cc46`) for arm64 Android (static llama/ggml, needs only
  bionic libc/libm/libdl, stripped to 29 MB for the three binaries) and for the
  Mac. `fetch-models.sh` got all 11 files (the table has 11, not 13), each
  `sha256 ok` against the HF API. Mac smoke on two made-up screens: Julia-1 0/2
  and Laya 0/2 (both picked option "1" every time; watch for position bias),
  Kev-0.8B 1/2, Qwen3-VL step with image 2/2 valid `tap` calls. No model
  rejected the request shape, which matches the `b11803` README.
  Facts for later tasks:
  - The Mac's port 8080 is held by the owner's own Python process, so use
    18080 on the Mac side (`adb forward tcp:18080 tcp:8080`,
    `--url http://127.0.0.1:18080`).
  - Phase 1 must pin or drop llama-server's web UI: its build downloads it from
    the HF bucket `ggml-org/llama-ui` at "latest".

- 2026-11-05 (session 2): the owner said go for adb. Task 3 done: 20 screens
  in `$BENCH_DIR/screens/` (`screens.json` + `NN.png`). Settings 01–05, Clock
  (`com.android.deskclock`) 06–10, Play Store 11–15, Store 16–20. There are 4
  `done` and 3 `unsure` answers, and the largest screen has 23 options.
  `validate.mjs` checks every entry with `pickerRequest`. Entry 20 reuses the
  Store's top view with another sub-goal. The phone was off the charger
  (70–71%). During capture the package installer opened once and adb dropped
  once; I paused and asked both times. Helper `screens/cap.sh` refuses to act
  if anything other than these apps or the launcher is in front, or if
  Deputy's RunService is running.

- 2026-11-05 (session 2): Task 4 started. `tools/model-bench/phone.sh` is
  written (PORT env picks the phone port; the Mac side is `1$PORT`). Step 1
  passes: the phone runs `llama-server` (commit `a37cc46`). The CPU is
  2×2.2 GHz + 6×2.0 GHz, with asimddp and fphp. Scratch helpers in `BENCH_DIR`:
  - `guard.sh` checks that the launcher or lock screen is in front, Deputy
    isn't running and the phone is charging.
  - `prun.sh` runs a phone command under nohup and pulls its log.
  - `push-all.sh` pushes every model file.
  - `screens/one-0N.json` are single-screen files for Step 4.

  Wi-Fi adb copies at only 0.8–1.3 MB/s. Julia, Laya, Kev and the
  Qwen3-VL main file reached `/data/local/tmp/mb`. Then adb lost the phone
  during the Qwen3-VL mmproj, after the charger came out. `svc power stayon ac`
  is set on the phone; reset it with `svc power stayon false` at cleanup.

- 2026-11-05 (session 2, 20:35): Wi-Fi adb dropped four times and copied at
  about 1 MB/s. The owner then plugged in a USB cable (serial
  `49kjmnuwonkffqzh`, charging over USB). The Wi-Fi link is disconnected. Every
  command runs with `ANDROID_SERIAL=49kjmnuwonkffqzh` (`phone.sh` accepts it in
  place of the one-device check). The phone has `svc power stayon usb` set.
  `push-retry.sh` resumes the copy and skips files already there at full size.

- 2026-11-05 (session 2, ~20:45): all 11 model files and `01.png` are on the
  phone over USB (about 3 min; Wi-Fi had managed about 1 MB/s). Step 2 hasn't
  run: the guard stopped because the owner's Design Editor was in front. The
  owner then said other sessions have the phone. `apps-hub-63` has it now,
  `strongroom-sync-dc` is second and Model Host is third. `strongroom-sync-dc`
  promised to message "phone free" and to leave `/data/local/tmp/mb` and the
  stayon setting alone.

  The Mac pre-run of the Picker on the 20 real screens is **not phone data**:
  Julia-1 1/20, Laya 2/20, Kev-0.8B 11/20 (`BENCH_DIR/mac/*.picker.md`).
  Julia-1 and Laya keep picking option "1". Kev over-picks "unsure". Likely
  cause, not yet fixed: `b11803` `server-decision.cpp` (`fill_task_laya`) cuts
  the head (state + instructions) to `max_head_tokens` minus the options'
  tokens. The README says long questions and options are truncated. Our
  `criteria` repeat each full TreeDump line, so the task and sub-goal may be
  cut away.

- 2026-11-05 (session 3, `apps-hub-ad`): told `strongroom-sync-dc` that this
  session holds Model Host's phone turn and asked for "phone free" here. The
  Picker request fix is done (Mac only, test first, bench 9/9, typecheck
  clean). The sub-goal now leads `instructions`, and each `criteria` value is
  just the kind and label (`text "Bluetooth"`). The full line stays in
  `state`. Head budgets from the GGUF metadata: Julia 256 tokens, Laya 192.
  For laya-type models the head is the question plus the options; the state
  comes after them and isn't cut.
  Mac re-run (**not phone data**, `BENCH_DIR/mac2/`): Julia 3/20 (needs
  `-ub 4096 -b 4096` too, because screen 12 is 547 tokens), Laya 1/20, Kev 12/20.
  Before the fix: 1, 2, 11. The prompts match each model's `systemone`
  template. Julia and Laya no longer stick on "1" but are confidently wrong.
  The truncation was real but wasn't the main cause, and the two small
  encoders look too weak for this task. Kev is the only Picker candidate so far.

## Current state + exact next step

Phase 0 is done on the phone (2026-11-06, about 00:56). Tasks 1–4 are
complete in the ledger. The results tables and the Task 5 decisions are under
"Evidence", in "Phase 0 results". The spec's §6, §7.4 and §8 carry the
measured numbers. Nothing is committed (branch `model-host`). The phone went
back to `strongroom-sync-dc` with "phone free": `/data/local/tmp/mb` is
deleted, `svc power stayon` is false and the forwards are removed. Model
Host needs no more phone time unless the owner picks option C.

Session 3 log (2026-11-05 22:00 to 2026-11-06 01:00):
- Ran the Picker request fix, then Steps 2 and 3. Step 3 switched to 720 px
  JPEG.
- Fixed `phone.sh serve`. Its hang cost 38 min.
- Ran a trimmed Steps 4, 6, 7 and 8 at the owner's "it's taking too long".
  Then `bench.ts` recorded tool arguments, and the taps were scored.
- Cleaned up the phone (Step 10).
- Every cut and choice is a `Ruling:` line in the ledger.

Recommendation given to the owner (not yet answered):
- **A (recommended):** stop Model Host for this phone. Deputy stays on the
  cloud. Keep the bench and these results.
- **B:** build the Picker only. Kev runs text-only and picks elements locally;
  the cloud or Thinker decides "done" and "unsure", which Kev gets wrong
  (0/7, and it taps instead of stopping). An in-sample 0.35 gate answers 12
  of 20 and gets 10 right, but both of its errors are unwanted taps. About
  9 s per local pick at ≤ 23 options, which is slower than the cloud
  (Groq < 1 s, §10). Real screens have about 60 options. It needs 2.8 GB of
  RAM. This overrides §7.4's ≤ 2 s and 16/20 bar, so it's the owner's call.
- **C:** spend one hour trying the MNN-LLM runtime on the same phone before
  deciding. It needs the phone again: re-push the files, and the queue rules
  apply.
- A Try screen (a photo read locally with a progress bar, InternVL3-1B) is
  the one job that passes. It's a low-priority idea, not a reason to build
  Model Host.

Next, in order:
1. Get the owner's pick (A, B or C) and whether to commit the branch. The
   uncommitted files are `tools/model-bench/`, the spec, the plan, this
   handoff and `pnpm-lock.yaml`.
2. The final whole-branch review is done (2026-11-06): 0 Critical, 3 Important
   (all fixed; suite 10/10) and 10 Minor (deferred). They're in the ledger as
   `Final:` lines. After the owner's commit answer, run
   finishing-a-development-branch and delete
   `.superpowers/sdd/2026-11-05-model-host-phase-0/` only once the work is
   committed.
3. A → close Model Host in this handoff. B → write the Phase 1 plan
   (superpowers:writing-plans) for a Picker-only Model Host with Kev-0.8B,
   `-t 2 -c 4096` and a 0.35 gate. C → write a one-task spike plan for MNN.
