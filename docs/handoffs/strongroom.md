# Handoff: Strongroom (own-code password manager)

## Resume prompt

Dated 2026-10-29. Read `docs/handoffs/strongroom.md` completely first, then
`docs/strongroom/DESIGN.md`. Trust the decisions and verified facts below and
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
- `.superpowers/brainstorm/6147-1793289451/content/android-flows.html`: mockups (not committed).

## Session log

- 2026-10-29: brainstorming session; design written; builder check run; owner
  answered its two questions; DESIGN.md updated.
- 2026-10-30: Windows added to Phase 3 (same Chrome extension); design approved;
  Phase 1 plan written and self-reviewed.

## Current state + exact next step

DESIGN.md approved by the owner on 2026-10-30. Phase 1 plan written
(`docs/strongroom/PHASE-1-PLAN.md`) and waiting for the owner's review and
choice of execution method (subagent-driven or native). Nothing is committed.
Next: once the owner approves the plan, create branch `strongroom-phase-1` and
start at Task 1 (security-engineer threat-model review). Phone installs only via
the Store (release builds); debug work uses the emulator.
