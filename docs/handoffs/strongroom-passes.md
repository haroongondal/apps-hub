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

- 2026-11-18: plan approved by the owner; worktree created; wave 1 (T1 model, T2 NDEF/Type4Tag, T3 zxing barcode) dispatched.

## Current state + exact next step

Wave 1 running. Next: collect reports, check `git show --stat`, run tests, then wave 2 (T4 bridge, T5 service, T6 UI; briefs and contract are in `.superpowers/sdd/strongroom-passes/`).
