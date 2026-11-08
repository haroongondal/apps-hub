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
- 2026-11-08: executing the plan with subagent-driven development (skill `superpowers:subagent-driven-development`; implementer + task reviewer per task, opus reviewer for security-sensitive tasks). Done and reviewed clean: Task 1 (setup), Task 3 (Import in a tab, ee5b3ef), Task 4 (core exportForChrome, 6ee0d91), Task 5 (export request + screen, 9de6293). Task 6 (DeviceVault): implemented 70d16da; opus review found 3 Important (short/empty PRF accepted, unserialized writes, IndexedDB wrapper used before commit); fix round 1 committed 831a581 (88/88 extension tests); scoped re-review was dispatched and its result was NOT yet read when this handoff was written.
- Counts now: strongroom-core 148, strongroom-extension 88 unit + e2e 60/60 (as of Task 5).

## Current state + exact next step

Branch `strongroom-extension-security`, HEAD 831a581, worktree clean apart from git-ignored `.superpowers/`. The SDD ledger is `.superpowers/sdd/2026-11-08-strongroom-extension-security/progress.md` (git-ignored scratch; if it is gone, rebuild it from `git log`: tasks 1, 3, 4, 5 complete, task 6 in fix loop).

Exact next step: finish Task 6. A scoped re-review of fix commit 831a581 (diff file `review-70d16da..831a581.diff` in the SDD workspace) was running as an agent; re-run it if you have no result (use the findings list in the ledger line "Task 6: review (opus)"). If all three findings are ADDRESSED, append `Task 6: complete (commits 9de6293..831a581, review clean)` to the ledger and go on to Task 7. If not, run fix round 2 (rounds 1-3 resume the implementer; 4-5 use a fresh one on a stronger model).

Then, in this order: Task 7 (account key sealed + migration; must read the key back before deleting the plain copy), Task 8 (lock-free fills), Task 11 (core escrow), Task 12 (Worker), Task 13 (transport), Task 14 (email recovery in the extension; creates the popup Settings screen and `Deps.settings` if absent), Task 15 (lost access), Task 16 (gates, docs, reviewers; final whole-branch review on the strongest model), then Task 9-10 only if the spike passed. Task 17 (real mail adapter) stays blocked on the owner.

## Owner-only steps still pending (cannot be done by an agent)

1. Fingerprint spike (plan Task 2): files are ready in `/private/tmp/claude-501/-Users-outsentia-Documents-apps-hub/ceb46fd4-ad8e-4fe4-972b-3dc0ef165dc7/scratchpad/spike/` (MV3 extension: `chrome://extensions` > Developer mode > Load unpacked > that folder > click its toolbar icon > Enroll, Verify, Verify from a popup window > paste the box). Decides whether Tasks 9-10 are built. Copy the folder somewhere permanent first if /tmp is cleaned.
2. Plan Task 5 step 6: import the CSV the Export button writes at `chrome://password-manager` and confirm the logins appear; also check the download works when Chrome is set to "Ask where to save each file" (the popup may close; if so move Export into a tab like Import).
3. The email sender question (which Cloudflare mail feature, which sender address, is there a domain with a verified address on the `personal` account) blocks Task 17 and any deploy.

## Working notes for the next session

- The shell's working directory resets to the main checkout `/Users/outsentia/Documents/apps-hub` between calls: start every Bash command with `cd /Users/outsentia/Documents/apps-hub/.claude/worktrees/strongroom-ext-security`, and tell every subagent to do the same. Never edit the main checkout or other worktrees.
- SDD scripts: `/Users/outsentia/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.0/skills/subagent-driven-development/scripts/{task-brief,review-package,sdd-workspace}`; plan path `docs/superpowers/plans/2026-11-08-strongroom-extension-security.md`.
- Owner rules: no Claude attribution or Co-Authored-By in commits; explicit `git add` pathspecs; never push, merge, release or deploy without the owner's word; vault-api package filter is `@apps-hub/vault-api`.
- Deferred minors and the rulings are in the ledger; collect every `Ruling:` line into the final message under "Rulings I made".
