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
