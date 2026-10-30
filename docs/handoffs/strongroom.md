# Handoff: Strongroom (own-code password manager)

## Resume prompt

Dated 2026-10-30. Work only in the worktree
`/Users/outsentia/Documents/apps-hub/.claude/worktrees/strongroom-phase-1`
(branch `strongroom-phase-1`). Read `docs/handoffs/strongroom.md` there
completely first, then `docs/strongroom/DESIGN.md`, then the SDD ledger at
`.superpowers/sdd/PHASE-1-PLAN/progress.md`, and continue executing
`docs/strongroom/PHASE-1-PLAN.md` with superpowers:subagent-driven-development. Trust the decisions and verified facts below and
don't re-ask or re-derive them. Follow the handoff contract in
`~/.claude/CLAUDE.md`. Read "Current state + exact next step" before doing
anything, then continue from it. Commit or release only when the user says so.

## Goal and fixed constraints

- Personal password manager replacing Google Password Manager, **all the
  owner's own code** (self-hosted Vaultwarden/Bitwarden or KeePass apps were
  offered and declined).
- Android first (apps + Chrome on the phone), then Cloudflare sync, then a Chrome
  extension on the Mac, then Firefox. iPhone + Safari deferred: no paid Apple
  developer account.
- Repo rules (AGENTS.md): Expo SDK 54 / RN 0.81.5, `@apps-hub/ui` for all UI,
  native code in Expo local modules, `node --test` for TS, Gradle JVM tests for
  Kotlin, no telemetry, FOSS dependencies only.
- Install on the phone only through the private Store (memory: install-via-store-only).

## Decisions made (with why)

Owner's answers, 2026-10-29:
- **Why:** all four reasons at once: a company could read the passwords, a breach
  could leak them, a locked account could lose them, and they want to own it.
- **Build scope:** all own code.
- **Sync:** the owner's own Cloudflare account, ciphertext only.
- **Apple:** not now; keep the design open for iPhone/Safari.
- **First:** Android phone end to end.
- **Import:** yes, from a Google Password Manager export.
- **Forgotten master password:** recovery key shown once at setup.
- **Contents:** logins, cards, secure notes. No 2FA codes.
- **Mockups:** accepted ("go ahead") after viewing the Android fill/save/vault mockups.
- **Locked fill:** show the matching login while locked, via a Keystore-encrypted
  match index of sites/apps/usernames (passwords stay locked). Chosen over a
  generic "Unlock" chip.
- **Backup gap:** Phase 1 is testing only. Google stays the daily autofill
  service until Phase 2 sync runs. No backup-file feature.
- **Windows (2026-10-30):** owner also uses Chrome on Windows. Phase 3's Chrome
  extension covers Mac and Windows; no desktop app (Chrome only lets extensions
  fill pages).
- Builder-check points adopted as Claude's calls: webDomain trusted only from
  allowlisted browsers, revealed passwords hidden from accessibility services,
  sync token in a no-auth Keystore key (download-only while locked), base-rev
  409 on stale uploads, owner-run redaction script for the import fixture.

Claude's calls (marked in DESIGN.md, owner can override): name "Strongroom",
`com.haroon.strongroom`, Kotlin owns the vault, minSdk 33, AES-256-GCM + Argon2id
+ HKDF, D1 for the Worker, 5-minute auto-lock, master password ≥ 12 chars,
no password generator / CSV export / card saving in v1.

## Evidence / facts already verified

- `tools/store-api` is the Worker pattern to copy: `cf` CLI,
  `cloudflare.config.ts` with the personal account id, secrets in `.dev.vars`,
  `safeEqual` for constant-time token compare.
- Apps register for release in `tools/release/src/apps.ts`.
- Deputy sets `android.minSdkVersion=33` in `apps/deputy/android/gradle.properties`.
- No crypto dependency exists in the repo yet.

## File map

- `docs/strongroom/DESIGN.md`: the design.
- `docs/strongroom/PHASE-1-PLAN.md`: Phase 1 plan, 12 tasks (Task 1 = threat-model gate).
- `.superpowers/brainstorm/6147-1793289451/content/android-flows.html`: mockups (git-ignored).
- `.superpowers/sdd/PHASE-1-PLAN/`: SDD ledger (`progress.md`), Task 1 rulings,
  report and review (git-ignored scratch; the git log is the durable record).

## Session log

- 2026-10-29: brainstorming session; design written; builder check run; owner
  answered its two questions; DESIGN.md updated.
- 2026-10-30: Windows added to Phase 3 (same Chrome extension); design approved;
  Phase 1 plan written and self-reviewed. Owner chose subagent-driven execution.
  Worktree created (another session owns the main checkout on deputy-speed).
  Baseline `pnpm test` exit 0 (181 pass). Task 1: security-engineer threat model
  (17 findings, 0C/5H/5M/7L) → rulings in `.superpowers/sdd/PHASE-1-PLAN/task-1-rulings.md`
  → folded into DESIGN.md + plan (commit 5879adb) → review: 1 Important + 11
  Minor → fix round 1 (20b52ef) → re-review clean. Task 1 complete. Task 2 started.

## Owner items to raise at the end of Phase 1 (from Task 1)

- Before Phase 2: decide whether to add an account key (a second secret typed
  once per new device). It protects the server copy if the password leaks (A4).
- "Other logins" defaults to Fill once. "Always use here" is a separate button
  (A1/A2). Every card fill asks for the fingerprint (B10).
- Deputy should refuse to operate Strongroom (B5). That's a Deputy change,
  outside this plan.
- Mi Browser (HyperOS) isn't on the browser allowlist, so it only gets
  domain-scoped links.

## Current state + exact next step

DESIGN.md and PHASE-1-PLAN.md approved (2026-10-30). The owner chose
**subagent-driven** execution (superpowers:subagent-driven-development). The
redacted Google export comes later, so Task 7 uses a hand-made fixture until then.

Work happens in the **worktree**
`/Users/outsentia/Documents/apps-hub/.claude/worktrees/strongroom-phase-1`
(branch `strongroom-phase-1`, from main `6daca33`). Another session works on
`deputy-speed` in the main checkout, so never switch branches there. The
untracked copies of these docs in the main checkout are stale. This worktree's
copies are the source of truth.

SDD ledger (task progress, rulings, deferred minors):
`.superpowers/sdd/PHASE-1-PLAN/progress.md` in the worktree. Trust it and
`git log` over memory. Phone installs only via the Store (release builds);
debug work uses the emulator.

**Exact next step:** Task 1 is complete (re-review clean, 2026-10-30). Tasks
2–12 run in order with the SDD loop. The ledger's last lines say which task is
in flight and whether it is at implement, review or a fix round; resume there.
Minors carried forward from Task 1 (into Tasks 6 and 9–11) are ledgered.
