# Handoff: Strongroom passes (barcode and NFC-tag cards)

## Resume prompt

Dated 2026-11-18. Work in the worktree `/Users/outsentia/Documents/apps-hub/.claude/worktrees/strongroom-passes` (branch `strongroom-passes`, from main 226a9470). Read this file completely, then `docs/superpowers/plans/2026-11-18-strongroom-passes.md`, then the ledger `.superpowers/sdd/strongroom-passes/progress.md` (rulings bind). Trust the verified facts and do not redo finished tasks. Orchestrate with `cd-engineering-tools:parallel-agents-coord` (never superpowers:subagent-driven-development). Follow the handoff contract in `~/.claude/CLAUDE.md`. Never push, merge, release or touch the phone without the owner's word; phone installs only via the Store.

## Goal and fixed constraints

A fourth vault entry type `pass` (name, code, format qr|code128|ean13, note): shown as a barcode, optionally presented over NFC as an NDEF Type 4 tag via HCE for 60 s. Not payment, no cloning of MIFARE/DESFire, not in autofill or the match index. F-Droid-pure (zxing core only new dependency).

## Decisions

See the plan (decisions section) and the ledger rulings R1-R6. Plan gap found 2026-11-18: main has `packages/strongroom-core/src/entry.ts` (TS model for sync and the Chrome extension), so Pass is added there too (R2).

## Verified facts

- Base main 226a9470 already contains sync, Chrome extension and 0.3.0.
- `pnpm install --frozen-lockfile` works in the worktree; `node --test packages/strongroom-core/src/__tests__/vault.test.ts` passes (12/12) at base.

## File map

See the plan's file map plus `packages/strongroom-core/src/entry.ts`.

## Session log

- 2026-11-18: plan approved by the owner; worktree created from main 226a9470; wave 1 (T1 model, T2 NDEF/Type4Tag, T3 zxing) then wave 2 (T4 bridge, T5 HCE service, T6 UI) built by parallel agents; three batched reviews, one fix wave (quiet zones, Code 128 OOM, lock race, validation parity, manifest test), one scoped re-review, one last minor fix. Ledger with every ruling: `.superpowers/sdd/strongroom-passes/progress.md` (untracked, gitignored).
- Clean-export gate on 3e8d7812: strongroom-core 147, strongroom 75, strongroom-extension 70 tests pass, three typechecks clean, Gradle `:strongroom-vault:testDebugUnitTest :app:assembleDebug` BUILD SUCCESSFUL (444 tests, 1 skipped, 0 failures).

## Current state + exact next step

Code complete on branch `strongroom-passes` (HEAD 3e8d7812), not pushed, not merged, not released, nothing run on the phone. Next, only on the owner's word: (1) pick the base: rebase onto main if it moved, and check branches `strongroom-otp` and `strongroom-mobile-email-recovery` for conflicts in Entry/Login; (2) `pnpm release` locally for Strongroom, then the phone check in the plan (claim `device:<ro.serialno>` with coord first; real phone only; install through the Store): barcode scans from a real scanner, a second NFC phone reads the URL/text while armed, reads nothing unarmed or after 60 s or on a locked phone, HyperOS lets Strongroom win the NDEF AID over Google Wallet.

Open items: (a) "Export all" does not include passes (GoogleImport would read a pass row as a login); the notice says how many were skipped; to include them add a `pass` branch to GoogleImport.kt, a CsvExport row and an importer test; (b) already-released app and extension builds show passes as "unreadable" (kept unchanged, never dropped): mention in release notes; (c) the service claims the NDEF AID permanently (R10); (d) untested without a device or RN renderer: OnDestroy and the lock re-check, PassView mounted/busy refs, brightness; (e) NFC Forum constants taken from memory (MLe 0x3B, MLc 0x34, P2 0C/00, SW codes) pass the libnfc/Core NFC read sequence in review but are unproven on a real reader.
