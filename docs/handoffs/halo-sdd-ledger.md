# SDD ledger — plan: docs/superpowers/plans/2026-11-17-halo.md

Worktree: ~/Documents/apps-hub-wt/halo, branch `halo`. Base before Task 1: 28e27be.

## Conflict scan
- Tasks 1–11 run strictly in order (each consumes the previous task's interfaces), so no two implementers share a
  file at once. Files touched by several tasks: `HaloEngineModule.kt`, `modules/halo-engine/src/index.ts`,
  module `AndroidManifest.xml`, `apps/halo/App.tsx`, `apps/halo/package.json` (test list), `HaloService.kt`,
  `HaloListener.kt`, `EdgeOverlay.kt`. Sequential, so no locks needed.
- Task 12 (18 patterns) is the only parallel wave: per-family agents own their pattern files; `core/Patterns.kt`
  (registry) and `PatternsTest.kt` (family count) are shared → controller adds registry lines after the wave.
- Task 3 Step 3 references a "Share log" button: added to Task 2 Step 7 in the plan (fixed before start).

## Rulings
- Ruling: implement via a fresh implementer agent per task + reviewer, not inline — keeps the controller's context
  for coordination and phone work (owner's handoff rule) — costs more tokens than inline if wrong.
- Ruling: owner's "go ahead" (2026-11-17) covers the plan, the execution and the one Store release in Task 3 —
  it answered a message asking exactly those — if wrong, the Store release would be one the owner didn't want
  (low harm: their own private Store, same app set plus Halo).
- Ruling: no Claude attribution lines in commits (owner memory overrides the harness reminder).

## Tasks
Task 1: complete (commits 28e27be..92a013b, controller-checked: stat, lockfile diff, halo test rerun; no reviewer — scaffold, low risk). Concerns noted: prebuild not re-run (renamed Strongroom's committed prebuild, keeps release-signing block); lockfile has unrelated esbuild peer annotations (generated).
- Ruling: Tasks 5+6 (new pure-Kotlin files only) run in parallel with Task 2; Gradle serialised by filelock key `gradle-halo` (FILELOCK_ROOT=.sdd/locks) — saves wall time — if wrong, a lock wait or a compile break from the other agent's uncommitted files.
Task 2: dispatched (native-module-engineer, sonnet, OWNER task2). Tasks 5+6: dispatched (general-purpose, sonnet, OWNER task56).
Task 5: complete (095712b, controller-checked: stat + tests 7/7; layout ruling by implementer: log bands, max-magnitude per band, level = mean of bands).
Task 6: complete (6e42b12, controller-checked: stat + tests 8/8).
Task 7: dispatched (general-purpose, opus — pattern design quality, OWNER task7), parallel with Task 2.
Task 7: complete (7c378ac, controller-checked: stat, 27/27 JVM tests). Notes for Task 8: DrawList glow = blur radius px; roundness NOT applied by patterns — Task 8 must scale EdgePath corner radii by params.roundness; ember-drift up to 256 blurred dots (512 mirrored) = frame-time risk, measure in Task 11. Task 12 reuses helpers in Pattern.kt.
Task 2: reviewed by controller (overlay flags, manifest, lock-screen: no requestDismissKeyguard, AodActivity not exported). Fix round 1 sent: (1) IMPORTANT window alpha <= 0.8 or Android 12+ drops all pass-through touches (untrusted-touch rule); (2) FLAG_LAYOUT_NO_LIMITS + fitInsetsTypes 0 (overlay stopped above nav bar); (3) minor BootReceiver action check.
- Ruling: edge overlay window alpha capped at 0.8 (platform rule for touch pass-through) — lights are slightly dimmer than full opacity — if wrong, nothing: it is required.
Task 9 step 1 (Quantize core): complete (2a1442c, controller-checked: stat, 6/6). Android wiring of Task 9 still to do (after Task 8).
Task 2: complete (233805c..ec44238, controller review + 1 fix round: touch pass-through alpha 0.8 proven on emulator, full-display overlay, boot action check).
- 2026-11-17: local main was 7 behind origin/main (Store build 18 already knows Clipboard + Inflow). Rebased `halo` onto origin/main d1b61ea; conflicts were additive (store-manifest, apps.ts, tokens, AGENTS, .gitignore); tokens.css regenerated; gates green after rebase.
- Ruling: Halo keeps hue 190 although Inflow's provisional brand also uses 190 (accents differ: Halo #22D3EE, Inflow #5EEAD4) — cost if wrong: two apps with near-identical backgrounds; change Halo's hue later.
- `pnpm release store` was DENIED by the permission classifier (Store release not explicitly authorised). Asked the owner. Halo release alone is useless until the Store knows the `halo` id.
Task 4: dispatched (general-purpose, sonnet) while waiting on the owner.
Task 4: complete (408cb55, controller-checked: stat; TS 23/23, JVM 38/38). TS impl lives in modules/halo-engine/src/settings.ts, app re-exports it; HaloService companion applySettings/onSettings hook for reloads.
Task 8: dispatched (native-module-engineer, opus — perf/touch risk).
- Session restart interrupted Task 8 (only AudioWatch.kt + test written, uncommitted); resumed the same agent by SendMessage.
- 2026-11-17: owner said "release the app". Released from a clean detached worktree ~/Documents/apps-hub-wt/halo-release at 9f40f56 (keeps Task 8's uncommitted WIP out): Store 19 published ("knows Halo"), Halo 2 published (spike build: Task 2 probes + settings + AudioWatch unwired).
Task 8: implemented (9f40f56..13ed93c; JVM 43/43, TS 23/23; emulator: reacts, idles, rotates, taps pass). Reviewer dispatched (risky: touch/perf). Implementer deviations accepted: no listener access → playing=false (else random motion never idles); glow = blurred pass + sharp pass; butt caps; beat cleared per draw.
Task 8: minor (deferred): status OK/IDLE flaps on faint noise (needs hysteresis); Probe.audioStatus/level unused leftovers.
Task 11 note: onDraw p95 excludes RenderThread; on the phone use `dumpsys gfxinfo com.haroon.halo` too.
Task 8 review (opus code-reviewer): 2 Important — (a) HaloService.kt:96 `media = MediaWatch(..).also{start()}` reads media before assignment → playing state lost at start; (b) AudioWatch.onInit(false) resets lastSoundMs → random motion dark 3 s after every retry. 1 Minor (deferred): per-frame FrameInput alloc + Long boxing in EdgeView. Fix round 1 queued for the Task 8 implementer after Task 9b commits (same files).
Task 9: complete (2a1442c core + b98e973 wiring; controller-checked stat; emulator: wallpaper source + live wallpaper change + palette fallback proven; album art unit-tested only — check on phone in Task 11).
Task 8: complete (9f40f56..558125f, review + 1 fix round; both Important fixed, new test red→green; Minor alloc fixed; extra: listener reconnect rebuilds MediaWatch). Re-review skipped: fix diff evidenced by failing-then-passing test + emulator log (controller check). Open → moved into Task 10: getActiveSessions can throw right after the listener grant; add delayed retry of MediaWatch.start().
Task 10: dispatched.
Task 10: complete (287a08c, 4a125d5; controller-checked: stat, TS 27/27, typecheck; JVM 45/45 per report; emulator walk-through light+dark). Deviations accepted: Status.batteryUnrestricted added; enabling starts service from SettingsStore.write; "Music is playing." (no app label); off-switch thumb muted colour.
- Ruling: skip a separate Store install of the spike build (Halo 2, never installed); release 0.2.0 (2a) instead, which keeps all spike probes + start paths, so one owner install answers Task 3 and Task 11 — cost if wrong: if 2a breaks on the phone, the spike answers are muddier than from the bare probe build.
- 2026-11-17 ~02:30: Halo 0.2.0 released (versionCode 2, 946518f). Found the manifest had lost Store 19 + the first Halo 2: the Inflow session's first release (inflow 2) raced ours and wrote a manifest read before them. Re-released Store 19 (same owner-approved release). Releases from parallel sessions can clobber each other — re-check the manifest after every release.
Task 12: wave dispatched (4 opus agents: lights/lines/particles/waves; shared file core/Patterns.kt under filelock; gradle-halo run key). Controller extends PatternsTest to 24 / 6 per family after the wave. Task 11 (phone check of 0.2.0) waits on the phone: queued in coord behind apps-hub-9a (background coord wait running).
Task 12 lights: committed 6ca6368 (breath 3, twin-flare 26, prism 48, lantern 24 ops). Lights agent committed Patterns.kt via index (HEAD + its lines only) because lines' entries were uncommitted in the tree.
Task 12 lines: committed 0439488 (mirror-bars 56, dash-run 36, neon-tube 47, scanner 7 ops).
Task 12 particles: committed ae5e0a3 (rim-snow 113, sparks 119, fireflies 36, rain 71, bubbles 96 ops).
Task 12 waves: committed 181a526 (helix 168, aurora 152, ribbon 96, swell 96, pulse-wave 40 ops). Controller: PatternsTest now asserts 24 patterns / 6 per family; full gate 45 JVM tests green, assembleDebug OK.
- Ruling: release 0.3.0 (all 24) now instead of waiting for the owner to check 0.2.0 — owner hasn't installed 0.2.0 yet, so one install covers Tasks 3, 11 and 12 — cost if wrong: a bug in the new 18 patterns muddies the first phone check.
- Halo 0.3.0 released (versionCode 3, 3ce1532); manifest verified (store=19, halo=3). Whole-branch review (opus) dispatched over d1b61ea..HEAD.
Whole-branch review (opus): Important — (1) SCREEN_OFF receiver always registered → AodActivity turnScreenOn + KEEP_SCREEN_ON cancels the pending lock → phone stays UNLOCKED behind the clock (security) + screen can't stay off; shipped in 0.3.0 (owner told not to install it). (2) failed overlay add (no overlay permission yet) leaves overlay non-null → lights never appear after granting. Minor — (3) SettingsTest compares decode(expected)==decode(input), not literal values; (4) Diagnostics Start / BootReceiver / HaloListener start the FGS while lights are off → instant stopSelf, notification flash.
- Ruling: spike AOD stays testable behind a Diagnostics switch "Test the always-on screen" (off by default, stored), launches only when KeyguardManager.isKeyguardLocked, no KEEP_SCREEN_ON, auto-finish after 10 s — keeps Task 3 (d) testable without the security hole — cost if wrong: (d) might be untestable if HyperOS locks only after SCREEN_OFF (then press power with "instant lock").
Fix wave: one agent (native-module-engineer, opus) for all four.
Review fixes: b079db4 (SettingsTest literal compare, mutation-proven), f239c9c (AOD spike behind Diagnostics switch aodSpike off by default + keyguard-locked + once per lock + 10 s finish, no KEEP_SCREEN_ON; overlay add retry; no service start with lights off). JVM 47/47, TS 27/27.
- Ruling: accept fixer's once-per-lock rule (else clock re-launches every timeout) and RECEIVER_EXPORTED for the SCREEN_OFF/USER_PRESENT receiver (USER_PRESENT comes from SystemUI uid; both actions are protected broadcasts) — cost if wrong: none known.
- Ruling: release 0.3.1 before the scoped security re-review returns — fix is strictly safer than 0.3.0 and the owner may install soon — cost if wrong: a 0.3.2.
Scoped security re-review (invariant-reviewer, opus) of f239c9c: all ADDRESSED (no launch while unlocked, no keep-screen-on, single overlay window, no receiver leak, exported receiver sound). Minor (deferred): (a) Diagnostics: aodSpike switch on + lights off + Stop → switch reads on but service/receiver dead; (b) no test for the USER_PRESENT re-arm (state lives in the receiver).
- 2026-11-17: first 0.3.1 release attempt failed (exit 1, cause not captured; session restarted); re-run succeeded: halo 4 = 0.3.1 (0a6f780). Manifest re-checked.
Phone check 1 (0.3.1): FFT works in background; overlay hidden over keyguard by the system; frame time p50 24 ms / p95 109 ms → perf fix needed (blur). (b)/(d) pending owner.
Perf fix 125c207: glow via one RenderEffect blur on a quarter-size RenderNode; BlurMaskFilter removed. Emulator inconclusive (render-thread CPU halved on host GPU; percentiles flat). Releasing 0.3.2 to measure on the phone. Note: all glows now under all sharp shapes; low-glow particles get a fainter, wider halo.
Phone check 2 (0.3.2, installed via the Store by driving the phone UI; Play Protect scan → safe): frame time OK (0 % janky, p99 30 ms vs 150). Bug: service not restarted after app update → add MY_PACKAGE_REPLACED receiver in stage 3 (Task 3.4). (b) reboot and (d) always-on still pending owner presence.

# Stage 3 (plan docs/superpowers/plans/2026-11-17-halo-stages-3-5.md), approved 2026-11-17
Base before Task 3.1: HEAD at dispatch (see below).
- Ruling: Tasks 3.1+3.2 to one agent (3.2's NotifyRules consumes 3.1's SettingsNotify) — cost if wrong: a bit less parallelism.
- Ruling: Task 3.4 also adds the MY_PACKAGE_REPLACED receiver (phone bug: service not restarted after update).
Stage 3 base: e4bc721
Tasks 3.1+3.2: complete (8d32327, 9566607; TS 46/46, JVM 62/62, red→green shown; controller-checked). Implementer calls accepted (incl. reminder clock advances when skipped, tracking cap 200).
Tasks 3.3 + 3.5: dispatched in parallel (OWNERs t33, t35); shared files .sdd/shared-files.txt (EdgeOverlay, EdgeView, HaloService) under filelock; gradle-halo run key.
