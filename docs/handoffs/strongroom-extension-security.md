# Handoff: Strongroom for Chrome — lock-free autofill, fingerprint, export, email recovery

## Resume prompt

Dated 2026-11-08. Work in the worktree `/Users/outsentia/Documents/apps-hub/.claude/worktrees/strongroom-ext-security`, branch `strongroom-extension-security` (from `origin/main` 93f21a1, no upstream on purpose). Read this file completely first, then the spec `docs/superpowers/specs/2026-11-08-strongroom-extension-security-design.md` and the plan `docs/superpowers/plans/2026-11-08-strongroom-extension-security.md`. Trust the verified facts below and don't redo them. Follow the handoff contract in `~/.claude/CLAUDE.md`. Commit with explicit pathspecs and no Claude attribution; never push, merge, release or deploy without the owner's word. Then continue from "Current state".

## Goal and fixed constraints

Six owner requests for the extension (apps/strongroom-extension, packages/strongroom-core, tools/vault-api): fingerprint toggle, working Import, Export for Chrome, autofill with no unlock, encrypted account key, email recovery. Constraints are in the spec and the plan's Global Constraints.

## Decisions made (with why)

- Lock-free fills keep the vault key on the computer, wrapped by a non-extractable WebCrypto key (owner choice).
- Fingerprint on = a fingerprint before every fill (owner choice).
- The popup still locks; only fills skip the unlock (my call, spec "Calls made by me").
- Email recovery is one flow: escrow of `{recoveryKey, accountKey}` under an emailed code, 24-hour wait (spec).
- Ruling: the fingerprint spike (plan Task 2) needs the owner at a real Chrome, so Tasks 3-8 and 11-16 run first and Tasks 9-10 wait for the spike result.
- Ruling: plan Task 14 creates the popup Settings screen and `Deps.settings` if Task 10 has not; Task 10 then adds its group to them.

## Verified facts

- Baseline on origin/main 93f21a1 (2026-11-08): strongroom-core 143/143, strongroom-extension 70/70, @apps-hub/vault-api 20/20, both typechecks clean. The vault-api package name is `@apps-hub/vault-api`.
- Import is broken because Chrome closes the toolbar popup when the file picker opens; the e2e loads popup.html as a tab, which hid it.
- The Worker is single-account (`account.id = 1`), so there is one email address.
- Android 0.3.0 CSV export exists on main (`CsvExport.kt`); the extension has no export.

## File map

See the plan's task files. Extension: `apps/strongroom-extension/src/{service,storage,background,popup}.ts`. Core: `packages/strongroom-core/src`. Worker: `tools/vault-api/src`.

## Session log

- 2026-11-08: spec and plan written and approved; worktree created; baseline recorded (core 143, extension 70, vault-api 20).
- 2026-11-08: executing the plan with subagent-driven development (skill `superpowers:subagent-driven-development`; implementer + task reviewer per task, opus reviewer for security-sensitive tasks). Done and reviewed clean: Task 1 (setup), Task 3 (Import in a tab, ee5b3ef), Task 4 (core exportForChrome, 6ee0d91), Task 5 (export request + screen, 9de6293). Task 6 (DeviceVault): implemented 70d16da; opus review found 3 Important (short/empty PRF accepted, unserialized writes, IndexedDB wrapper used before commit); fix round 1 committed 831a581 (88/88 extension tests); scoped re-review: all addressed, Task 6 complete. Deferred for Tasks 9-10: send the PRF over chrome.runtime.sendMessage as base64 or a number array, never as a typed array (JSON turns it into `{}` and DeviceVault now refuses short secrets).
- 2026-11-09: Task 7 (account key sealed + migration): implemented 9b21be3 (also fixed service.test.ts's direct `localStore` usages — a required consequence of the task's own interface change — and a pre-existing test race, both disclosed and verified). Opus review found a spec gap: `getSyncLocal` trusted the sealed copy over a surviving plain entry, and `setAccount` never removed the plain entry on success, so a failed migration could let a stale key later overwrite a newer one; plus a plan-mandated non-atomicity finding (`DeviceVault.saveAccountKey` does its own write). Ruling made: reorder `setAccount` to seal last (crash lands in the existing "no account key, sign in again" state) rather than reshape Task 6's interface. Fix round 1 committed dc654f7 (95/95 extension tests); scoped re-review: both findings addressed, no new Critical/Important breakage; one narrow new edge case parked (see ledger). Task 7 complete.
- 2026-11-09: Task 8 (lock-free fills and sync from device keys): implemented 85f57e9 (unit 101/101, e2e 67/67; also fixed a pre-existing e2e check broken since Task 7). An automated security-scanner hook flagged the device-key persistence as a HIGH "auth bypass" during development — overridden as a false positive: it's the explicit owner-approved design (spec goal #4, "Decisions by the owner"), not an oversight. Opus review confirmed all five adversarial properties (gate stays candidates/fill-only, manual-lock-only clearKeys, FROM_PAGE and lookalike-host check unchanged, status from session key only, account key untouched by Lock) but found 2 Important: auto-lock was still stopping background sync against spec design.md §1, and the manual-Lock+restart e2e checks couldn't actually fail. Fix round 1 committed 9042b73 (101/101 unit, 67/67 e2e, revert-verified the e2e fix can fail); scoped re-review: both addressed, no new breakage. Task 8 complete.
- Counts now: strongroom-core 148, strongroom-extension 101 unit + e2e 67/67 (as of Task 8).

## Current state + exact next step

Branch `strongroom-extension-security`, HEAD 9042b73 (handoff commit on top may be one ahead — check `git log`), worktree clean apart from git-ignored `.superpowers/`. The SDD ledger is `.superpowers/sdd/2026-11-08-strongroom-extension-security/progress.md` (git-ignored scratch; if it is gone, rebuild it from `git log`: tasks 1, 3, 4, 5, 6, 7, 8 complete).

Exact next step: Task 8 is complete (fix round 1 re-review: both findings addressed, 0 open). Per the pre-flight ruling, Tasks 9-10 (fingerprint) still wait on the owner's spike result, so start Task 11 (escrow helpers in strongroom-core) next with a fresh implementer: brief via `bash <sdd scripts>/task-brief <plan> 11`, BASE = `git rev-parse HEAD`. Task 11 is pure-TS crypto helpers in `packages/strongroom-core` (`rotateRecoveryKey` in format.ts, `sealEscrow`/`openEscrow` in a new escrow.ts) — no UI, no extension/Worker wiring yet, lower risk than Tasks 6-8; a standard-tier implementer and reviewer are appropriate (not opus) unless something in the crypto design raises a flag.

Then, in this order: Task 12 (Worker — escrow and lost-access endpoints; opus or equivalent for task review, it's server-side auth/rate-limiting), Task 13 (transport), Task 14 (email recovery in the extension; creates the popup Settings screen and `Deps.settings` if absent), Task 15 (lost access), Task 16 (gates, docs, reviewers; final whole-branch review on the strongest model), then Task 9-10 only if the spike passed. Task 17 (real mail adapter) stays blocked on the owner.

## Owner-only steps still pending (cannot be done by an agent)

1. Fingerprint spike (plan Task 2): files are ready in `/private/tmp/claude-501/-Users-outsentia-Documents-apps-hub/ceb46fd4-ad8e-4fe4-972b-3dc0ef165dc7/scratchpad/spike/` (MV3 extension: `chrome://extensions` > Developer mode > Load unpacked > that folder > click its toolbar icon > Enroll, Verify, Verify from a popup window > paste the box). Decides whether Tasks 9-10 are built. Copy the folder somewhere permanent first if /tmp is cleaned.
2. Plan Task 5 step 6: import the CSV the Export button writes at `chrome://password-manager` and confirm the logins appear; also check the download works when Chrome is set to "Ask where to save each file" (the popup may close; if so move Export into a tab like Import).
3. The email sender question (which Cloudflare mail feature, which sender address, is there a domain with a verified address on the `personal` account) blocks Task 17 and any deploy.

## Working notes for the next session

- The shell's working directory resets to the main checkout `/Users/outsentia/Documents/apps-hub` between calls: start every Bash command with `cd /Users/outsentia/Documents/apps-hub/.claude/worktrees/strongroom-ext-security`, and tell every subagent to do the same. Never edit the main checkout or other worktrees.
- SDD scripts: `/Users/outsentia/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.0/skills/subagent-driven-development/scripts/{task-brief,review-package,sdd-workspace}`; plan path `docs/superpowers/plans/2026-11-08-strongroom-extension-security.md`.
- Owner rules: no Claude attribution or Co-Authored-By in commits; explicit `git add` pathspecs; never push, merge, release or deploy without the owner's word; vault-api package filter is `@apps-hub/vault-api`.
- Deferred minors and the rulings are in the ledger; collect every `Ruling:` line into the final message under "Rulings I made".
