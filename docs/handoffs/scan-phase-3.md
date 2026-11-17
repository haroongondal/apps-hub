# SDD ledger — plan: docs/superpowers/plans/2026-11-18-scan-save-polish-cards.md

Design: `docs/superpowers/specs/2026-11-18-scan-save-polish-cards-design.md`. Worktree
`.claude/worktrees/scan-phase-3`, branch `scan-phase-3`, from origin/main 2b4aa8a. Execution: the
`cd-engineering-tools:parallel-agents-coord` skill (owner's rule). Resume prompt at the end of
this file once the run is stopped for context.

## Partition (2026-11-18)

| Agent | OWNER | Owns (only this agent edits) | Tasks |
| ----- | ----- | ---------------------------- | ----- |
| N | native | `apps/pdf-editor-mobile/modules/pdf-scan/android/**` | N1 to N6 |
| C | core | `packages/scan-core/**` (except `src/types.ts`, lead) | C1 to C4 |
| U | screens | `apps/pdf-editor-mobile/app/**`, `src/scan/**` (except `session-data.ts`), `src/library/**`, the app's `package.json` `test` script | U1 to U4 |
| lead | lead | `modules/pdf-scan/src/index.ts`, `packages/scan-core/src/types.ts`, `src/scan/session-data.ts`, `pnpm-lock.yaml`, `app.json`, docs | Task 0, I1 |

Shared files (two agents edit): none. The streams are disjoint by directory, so no filelock is
used. Within a stream one agent runs its tasks in order.

## Rulings

- Ruling: no filelock and no coord for the three streams — directories are disjoint and each
  stream is one agent — costs nothing if wrong beyond a commit conflict on `pnpm-lock.yaml`, which only the lead edits.
- Ruling: per-task reviewers are replaced by section 5 of the skill (controller checks diff stat and
  named tests; one batched reviewer per wave on risky commits; one whole-branch review at close) —
  cost: a defect surfaces one review later.
- Ruling: `cardMode` is optional (`cardMode?: boolean`) in `ScanCameraViewProps` so the Phase 2 capture screen typechecks until Stream U passes it.
- Ruling: `scan-core` `package.json` `test` script lists its files by name; Stream C replaces the placeholder `types.test.ts` entry with its own list.
- Ruling: the app's tests of the sort `node --test` need no native; Stream N is the only stream that runs Gradle, to avoid two builds in one Gradle home.

## Log

- Task 0: complete (commit 15213cb). session-data tests 9 pass; scan-core test 1 pass; typecheck clean in both.
