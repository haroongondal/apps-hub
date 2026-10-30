# Handoff: Strongroom (own-code password manager)

## Resume prompt

Dated 2026-10-30 (second session). Work only in the worktree
`/Users/outsentia/Documents/apps-hub/.claude/worktrees/strongroom-phase-1`
(branch `strongroom-phase-1`; enter it with EnterWorktree path). Read
`docs/handoffs/strongroom.md` there completely first, then
`docs/strongroom/DESIGN.md`, then the SDD ledger at
`.superpowers/sdd/PHASE-1-PLAN/progress.md` (its rulings, carries and
deferred minors bind later tasks), and continue executing
`docs/strongroom/PHASE-1-PLAN.md` with superpowers:subagent-driven-development
(implementer and task-reviewer templates, a review after every task, explicit
models). Trust the decisions, verified facts and ledger and don't redo that
work. Follow the handoff contract in `~/.claude/CLAUDE.md`. Read "Current state
+ exact next step" before doing anything, then continue from it. Commit per
task on the branch; never push, merge or release without the owner's word;
phone installs only via the Store; debug runs on the emulator only, and the
owner's phone is attached over adb, so always target `-s emulator-5554`.

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
  Minor → fix round 1 (20b52ef) → re-review clean. Task 1 complete.
- 2026-10-30 (cont.): Task 2 scaffold (fcdc2ab: bcprov 1.86, biometric 1.1.0,
  autofill 1.3.0). Task 3 crypto (aefc01d + 51da896: KDF ceiling now also
  t ≤ 16, p ≤ 4; password bytes encode lone surrogates as U+FFFD like
  TextEncoder). Task 4 vault format + `vault-vectors.json` (c983a25 + ed7ba1b;
  reviewer recomputed every vector in Python and Node). Task 5 vault session
  (0d55a75 + 6a0bb2d + 8f288d0: a sealed `key-check` tombstone lets a
  biometric key be verified; header writes compare keys first). Task 6
  matching (69b67c0 + 8157955: PSL, test_psl and Chrome/Firefox digests match
  fresh downloads; fails closed on IDNA deviation characters and odd schemes).
  Task 7 import (f02537f + 9b73d29: unlinked logins keyed by raw URL/name,
  rows wider than the header refused, redaction script has a node test;
  the owner's real export is still needed for Step 0). Task 8 form detection
  (aad67dc + ce4aac2: ranked password signals, bounded keyword). Task 9
  Android adapters + JS bridge (6724726; emulator: setup/unlock/lock, Chrome
  trusted, fingerprint and reboot rules, no plaintext in db or index) in
  review. Rulings and deferred minors are in the ledger.
- 2026-10-30: Task 10 autofill service + UnlockActivity (8142517). **Task 10
  emulator results** (API 35, `apps-hub-test`; app checks used a throwaway
  native login app built in the scratchpad):
  - Works: app fill unlocked and locked (match index, then master password or
    fingerprint); `FLAG_IMMUTABLE` auth intents complete every fill (S6, no
    mutable intent needed); Other logins: Fill once stores no link, Always use
    here does; Save after sign-up, Update after a password change, locked save
    held in `pending.bin` and applied at the next unlock; card fill asks for
    the master password or fingerprint even when unlocked, and the locked
    "Unlock to fill a card" path; no "Save to Google" offer for the master
    password with Google selected; 30 s clipboard clear works with the app in
    the background (toast unchanged).
  - Needed `QUERY_ALL_PACKAGES`: without it package visibility hid every
    requesting app's certificate (`AppsFilter ... BLOCKED`), so nothing filled.
  - **Chrome not checked:** the emulator has Chrome 124 (third-party autofill
    starts at 131) and no Play Store. S1 frames, S2 `webScheme`, the port in
    `webDomain` and a checkout-page card fill in Chrome move to the phone
    (Task 12).
  - Firefox 158.0.2 (official Mozilla build, signer matches the allowlist)
    stood in: it sets `webScheme` (`http`), its `webDomain` has **no port**
    (`10.0.2.2` for `10.0.2.2:8000`), so a login linked to an IP address fills
    on any port of that IP (owner to know). A cross-origin iframe is reported
    under the frame's own origin (`localhost`), so the top page's login wasn't
    offered there. Firefox sends no card forms to autofill services.
  - Owner/Task 11–12 notes: right after a reinstall `autofillSelected` reads
    false until any autofill session runs (system NPE in `isServiceEnabled`);
    with the Strongroom process dead, the first fill can miss the system's 5 s
    timeout (debug build; recheck with release on the phone); an
    augmented-autofill-only session still opens on UnlockActivity's password
    field (it showed nothing).
  - Emulator state left: PIN 1234 + one enrolled fingerprint, Firefox and
    `com.example.logintest` installed, a fresh test vault (master password in
    the Task 9 check button), Google as the autofill service again.

**The owner's phone is attached over wifi adb.** Every adb/expo command must
target the emulator explicitly (`-s emulator-5554`). The emulator still holds
the debug app, a test vault, and a dev-server override to port 8082 (another
session's Metro holds 8081).

Debug runs use the AVD `apps-hub-test` (android-35 google_apis arm64):
`~/Library/Android/sdk/emulator/emulator -avd apps-hub-test`. Gradle builds
keep `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`.

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

**Exact next step:** Tasks 1–9 are complete (Task 9 re-review clean). Start
Task 10: record BASE (`git rev-parse HEAD`), dispatch the implementer (opus;
autofill service + unlock activity is the security-critical integration)
with the brief at `.superpowers/sdd/PHASE-1-PLAN/task-10-brief.md`, and carry
every ledger line marked "carry to Task 10" plus the ledger's `NEXT:` line
into the dispatch. Re-extract Task 11's brief before dispatching it (Task 9 amended the plan's
TS API: `EntryView.expMonth/expYear`, `clearLostSaves()`). Then Tasks 11–12
and the final whole-branch review (opus), pointed at the ledger's deferred
minors. Implementers so far: sonnet for Tasks 2–8, opus for Task 9; reviewers
opus for crypto/format/session/matching/platform, sonnet otherwise.
