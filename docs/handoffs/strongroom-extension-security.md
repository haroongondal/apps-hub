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

- 2026-11-08: spec and plan written and approved; worktree created; baseline recorded.

## Current state + exact next step

Plan Task 1 done. Next: Task 3 (Import in a tab), executed by subagent-driven development; ledger in `.superpowers/sdd/2026-11-08-strongroom-extension-security/progress.md`.
