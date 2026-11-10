# Handoff: opt-in email recovery for Strongroom mobile (Android)

## Resume prompt (paste into a new chat)

```
Read docs/handoffs/strongroom-mobile-email-recovery.md completely first. Trust
the verified facts in it and do not re-derive them. Follow the same handoff
contract (update the session log and current state as milestones land; at
~85% context, or when a compaction warning appears, stop, rewrite the resume
prompt with today's date, print it in a fenced block, and end the turn instead
of letting auto-compaction happen).

Goal: bring the opt-in email recovery feature — already shipped in the
Strongroom Chrome extension (apps/strongroom-extension) — to the Strongroom
Android app (apps/strongroom). Same user-facing capability: rotate the
recovery key, escrow it with the vault server under an emailed code, 24-hour
owner-cancellable wait if the master password and recovery key are both lost.
The Worker (tools/vault-api) already serves this generically for any client —
confirmed no server changes are needed. This is new client-side work only, on
the Kotlin vault core + the Expo module + the RN screens.

Start with superpowers:brainstorming to settle the design questions this
handoff lists as open, then superpowers:writing-plans for a task breakdown,
then superpowers:subagent-driven-development to execute it, in a fresh git
worktree (superpowers:using-git-worktrees) off main — this repo's
AGENTS.md/CLAUDE.md hard rules apply (no Claude attribution in commits/PRs,
explicit `git add` pathspecs, never push/merge/release without the owner's
current-context go-ahead, Kotlin owns the vault logic and RN only renders for
this app, coord-claim the app folder and the test phone's device:<serial>
before any build-install-test loop, never adb-install directly — go through
the Store once a build is ready).

Continue from "Current state" below.
```

## Goal and fixed constraints

- **Goal**: add the same opt-in email-recovery capability the extension has
  (DESIGN.md §11, "Security hardening") to the phone app, so a user who loses
  both the master password and the recovery key can still recover the vault,
  with the owner's explicit 24-hour cancel window.
- **Fixed constraints** (from this repo's AGENTS.md / CLAUDE.md, apply to all
  work on this task):
  - Strongroom is Android-only, private Store only (`com.haroon.strongroom`).
    Kotlin owns the vault; RN only renders.
  - Never `adb install` directly on the shared test phone — install through
    the Store once a build exists; fix Store bugs first if that's blocking.
  - Several sessions share this checkout and the phone — `coord claim` the
    app's folder before a build-install-test loop, and `device:<serial>`
    before touching the phone.
  - No Claude attribution/Co-Authored-By lines in commits or PRs (this is the
    user's standing preference and overrides any generic reminder saying
    otherwise).
  - Use explicit `git add <pathspec>`, never `-A` or `.`.
  - Never push, merge, or deploy anything without the owner's go-ahead *in
    that conversation* — a prior approval from this or another task doesn't
    carry forward.
  - The vault-server Worker (`tools/vault-api`) is **not yet deployed**
    (`PUBLIC_URL` unset in `cloudflare.config.ts`, `MAIL_FROM` hardcoded and
    unconfirmed by the owner). Deploying it was already offered to the owner
    in a separate conversation and not yet answered — this task does not
    require deploying it to build and unit-test the mobile client, but a real
    end-to-end mail test does need it deployed. Don't deploy it from this task
    without asking first.

## Decisions made so far

None yet specific to mobile — this file only captures the scoping
investigation. The design to mirror is already decided and shipped for the
extension (DESIGN.md §10 "Account key" and §11 "Security hardening", plus the
Phase 2 Sync section's email-recovery/escrow paragraphs) — treat that as the
spec, and the extension's implementation as the reference client.

Open design questions for the new session's brainstorming pass:
1. **Where the Escrow crypto lives in Kotlin.** The extension and the Worker
   both use `packages/strongroom-core/src/escrow.ts` (seal/open, email-code
   format). The phone's vault core is a *parallel Kotlin reimplementation*
   checked against shared test vectors (same pattern as `AccountKey.kt` vs.
   `packages/strongroom-core/src/crypto.ts` — see `apps/strongroom/tools/
   vectors/account_key_vectors.py`). This task needs an `Escrow.kt` (or
   similar) ported the same way, plus a new `escrow_vectors.py` (or an
   extension of the existing vectors file) so both clients and the Worker
   agree on the sealed-blob format and the email-code format byte-for-byte.
2. **UI placement and copy.** The extension puts this in its Settings screen.
   Mobile already has `apps/strongroom/src/SettingsScreen.tsx` and
   `SettingsFlows.tsx` with sync/account-key flows (`SyncScreen.tsx`,
   `sync-flow.ts`) to follow as the UI pattern. Needs its own copy pass
   (sentence case, active voice, says what happened and how to fix it) —
   don't copy the extension's popup copy verbatim without adapting it to the
   phone's existing Settings/Sync screen conventions.
3. **Whether this gates on sync being on.** Email recovery only makes sense
   once an account exists on the vault server (the escrow row lives in the
   same D1 `account` flow as sync). Confirm the plan requires sync to
   already be turned on before email recovery can be enabled, same as the
   extension.
4. **Background checking of a pending lost-access request.** The extension
   checks status on demand (popup open) and the Worker enforces the 24-hour
   wait server-side regardless of when any client checks. Decide whether the
   phone needs a background check (the existing 15-minute sync job could
   piggyback this) or on-demand-only (simpler, consistent with how the phone
   currently only syncs on unlock / periodic job / foreground).

## Evidence and facts already verified (session of 2026-11-11)

- The Android/mobile app (`apps/strongroom`) has **no email-recovery or
  lost-access code at all**. Verified: `grep -ril "accountKey|escrow|
  lost_request|lost-access|vault-api|loginToken|prelogin"` across
  `apps/strongroom/src` and `apps/strongroom/modules` hits only the sync
  machinery (which *is* fully built — see below), never escrow/lost-access.
- The phone app **does** already have full Phase-2 sync built and working:
  `apps/strongroom/src/SyncScreen.tsx`, `sync-flow.ts`, and on the Kotlin side
  `modules/strongroom-vault/android/src/main/java/expo/modules/
  strongroomvault/core/{AccountKey,SyncProtocol,SyncSession,SyncClient}.kt`
  and `android/{SyncConfig,HttpSyncTransport}.kt`. So the phone already talks
  to the same Worker for prelogin/account-create/account-update/push/pull.
- The Kotlin transport layer's account/sync surface is narrow and verified
  to **not** support escrow yet: `HttpSyncTransport.kt` only implements
  `prelogin()`, `pull()`, `push()`, and two `putAccount()` overloads (create,
  update) — no escrow field, no `/v1/lost/*` calls anywhere in
  `SyncClient.kt` / `SyncProtocol.kt`.
- The Worker (`tools/vault-api/src/index.ts`) routes are **entirely
  client-agnostic** — `PUT /v1/account` already accepts an optional `escrow`
  field (email + sealed blob + code) on both create and update, and
  `/v1/lost/request`, `/v1/lost/confirm` (+ mailed-link GET/POST pair),
  `/v1/lost/cancel`, `/v1/lost/status`, `/v1/lost/release`, and
  `DELETE /v1/escrow` are all already mounted and none of them read any
  client-identifying data beyond the bearer token / claim / mailed token.
  **No server-side changes are needed for mobile support** — this is
  confirmed, not assumed.
- The shared crypto (`packages/strongroom-core/src/escrow.ts`, tested by
  `packages/strongroom-core/src/__tests__/escrow.test.ts`) is the spec for
  the sealed-blob and email-code format that a Kotlin port must match
  byte-for-byte, the same way `AccountKey.kt` already matches
  `packages/strongroom-core/src/crypto.ts`'s account-key derivation (verified
  against `apps/strongroom/tools/vectors/account_key_vectors.py`, the only
  vector-generator file that currently exists under that directory).
- The extension's reference implementation of the client-side flow (states,
  not just crypto) is `apps/strongroom-extension/src/service.ts`: see
  `emailRecoveryStatus/Enrol/Confirm/Off/Cancel` (around lines 365-446) and
  `lostAccessRequest/Check/Open` (around lines 470-505), plus the message
  protocol's `emailRecovery` / `lostAccess` action union (around lines 54-62).
  The matching server-side orchestration (claim/confirm/cancel/status/release
  semantics, cooldowns, the 7-day release grace) is
  `tools/vault-api/src/lost-access.ts` in full (78 lines, already read this
  session — no server work needed, but worth reading once to understand the
  state machine the Kotlin client must drive correctly).

## File map

**Reference implementation (read, don't copy verbatim):**
- `apps/strongroom-extension/src/service.ts` — client-side email-recovery and
  lost-access state machine (the one to port).
- `apps/strongroom-extension/src/popup.ts` / `popup.html` — reference UI flow
  (adapt copy and layout to the phone's existing screens, don't transplant).
- `packages/strongroom-core/src/escrow.ts` + `src/__tests__/escrow.test.ts` —
  the crypto/format spec the Kotlin port must match.
- `tools/vault-api/src/lost-access.ts` and `src/index.ts` (routes) — the
  server state machine and wire contract. No changes expected here.
- `docs/strongroom/DESIGN.md` §10 ("Account key", "As built in Phase 2") and
  §11 ("Security hardening") — the authoritative design text.
- `docs/handoffs/strongroom-extension-security.md` — the full build history
  of the extension-side feature (17-task SDD plan), useful for the shape of
  problems that came up (the plan's two hardest review rounds were both in
  this area: atomicity of the escrow/account-row write, and a UI race in the
  unlock screen — worth re-reading before designing the phone equivalent so
  the same classes of bug are anticipated, not re-discovered).

**Mobile app, existing sync pattern to extend:**
- `apps/strongroom/modules/strongroom-vault/android/src/main/java/expo/
  modules/strongroomvault/core/AccountKey.kt` — the pattern for a Kotlin port
  of a `strongroom-core` crypto module, verified against a vectors file.
- `apps/strongroom/modules/strongroom-vault/android/src/main/java/expo/
  modules/strongroomvault/core/{SyncProtocol,SyncSession,SyncClient}.kt` and
  `android/{SyncConfig,HttpSyncTransport}.kt` — where new wire types
  (escrow field on `AccountUpdate`/`AccountCreate`, `/v1/lost/*` calls) and
  new session operations (enrol/status/confirm/off/cancel,
  request/check/open) need to land.
- `apps/strongroom/modules/strongroom-vault/android/src/main/java/expo/
  modules/strongroomvault/StrongroomVaultModule.kt` — the Expo module
  surface exposed to RN; needs new exported functions.
- `apps/strongroom/modules/strongroom-vault/src/index.ts` — the TS contract
  for the native module (per AGENTS.md's "wiring that spans files": a new
  native function touches the TS contract, the adapter, and the Kotlin side
  — iOS doesn't apply here, Strongroom is Android-only).
- `apps/strongroom/src/{SyncScreen.tsx,sync-flow.ts}` — the RN pattern
  (forms, field validation, copy tables) a new email-recovery flow should
  follow; likely lives alongside these or inside `SettingsScreen.tsx` /
  `SettingsFlows.tsx`.
- `apps/strongroom/tools/vectors/account_key_vectors.py` — the pattern for
  a new `escrow_vectors.py` (or an extended existing vectors file) generated
  independently (argon2-cffi / plain Python crypto), not by either client.

**Tests to extend, mirroring existing names:**
- `apps/strongroom/modules/strongroom-vault/android/src/test/java/expo/
  modules/strongroomvault/core/{SyncClientTest,SyncSessionTest,
  RecoveryKeyTest,VectorGen}.kt` — add the escrow/lost-access equivalents.

## Session log

- 2026-11-11: User asked for email recovery in the mobile app after noticing
  it was missing (it was built for the extension only in the prior session's
  17-task plan). Scoped the gap: confirmed mobile has full sync but zero
  escrow/lost-access code; confirmed the Worker is already generic and needs
  no server changes; confirmed the shared crypto spec
  (`packages/strongroom-core/src/escrow.ts`) and the Kotlin-port pattern
  (`AccountKey.kt` + `account_key_vectors.py`) to follow. No code written.
  This handoff file created; no worktree created yet for this task.

- 2026-11-11 (session 2): Read the handoff, then recon. Found the checkout the handoff was written in (`model-host`, local `main` 226a947) lacks PR #29 and the sync code; **local `main` is behind `origin/main` (89ab8a7) and has one unpushed commit (226a947, strong-password suggestion)**. Worktree `.claude/worktrees/strongroom-mobile-email-recovery`, branch `strongroom-mobile-email-recovery`, created off `origin/main`, not local main. Verified: Worker `/v1/lost/status` and `/v1/lost/cancel` accept the `read` token (the phone's background token); `DELETE /v1/escrow` and enrol need the login token. Phone `SyncSession.recover(recoveryKey, newPassword, accountKey?)` already does the server-side recovery the lost-access "open" step needs. No code written; brainstorming in progress.

- 2026-11-11 (session 2, later): Owner answered: pending request = in-app warning only (no system notification); lost-both entry point = Unlock screen. Wrote the design `docs/superpowers/specs/2026-11-11-strongroom-mobile-email-recovery-design.md`; a fresh reviewer's builder check raised 4 questions (lost-reply on enrol, recovery-key lifecycle, unconfirmed-request warning, queued account update); all settled in the doc as my calls (enrol writes the header locally first via `prepare`, then PUTs; New recovery key warns it turns escrow off; warn only once `releaseAt` is set; sync first if `accountPending`). Awaiting owner approval of the design; then superpowers:writing-plans.

- 2026-11-11 (session 2, later still): Owner approved the design. Wrote the 8-task plan `docs/superpowers/plans/2026-11-11-strongroom-mobile-email-recovery.md` (escrow crypto+vectors; wire+transport+fake; enrol/confirm/off/status; lost access; module+TS; RN logic; screens; docs+gates). Owner also asked me to read `/Users/outsentia/Documents/multi-agent-scenarios/prompts/S1-real-app-test.md` (a coordination-test template with unfilled placeholders; read only, not run). Awaiting owner's review of the plan and choice of execution method.

- 2026-11-11 01:25 (session 2, execution start): Owner approved the plan; chose execution via `cd-engineering-tools:parallel-agents-coord`, and chose "run the full S1 experiment" (`/Users/outsentia/Documents/multi-agent-scenarios/prompts/S1-real-app-test.md`, placeholders still unfilled, asked the owner for them). Controller baseline at f2f878f: Gradle `:strongroom-vault:testDebugUnitTest` 390 tests 0 failures; `pnpm --filter strongroom test` 64 pass; typecheck clean. coord claim held on `<worktree>/apps/strongroom`. Wave 1 dispatched in parallel (disjoint files): Task 1 (OWNER escrow, agent a6782492da35da8be), Task 2 (OWNER wire, a8bf0afaccad54083), Task 6 (OWNER rnlogic, a8ff4858bd4fd3a73, also adds the two TS types to index.ts). Gradle runs serialized by a filelock keyed on `apps/strongroom/android`. Next waves: review each commit by sha; then Task 3 then Task 4 (both edit EmailRecovery.kt, so sequential), then Task 5, Task 7, Task 8.

- 2026-11-11 (session 2, execution): Wave 1 results. Task 6 `ca0c461`+`b054ff8` (review found: email regex looser than the Worker, copy claiming a code is emailed at request time; fixed, 81 TS tests). Task 1 `a101247`+`638b8aa` (reviewer cross-checked the vector with the TS client and a library HKDF: byte-for-byte agreement; the optional TS `escrow.test.ts` vector check was skipped, noted in the design). Task 2 `5f330eb` approved with comments, fix round PENDING after Task 3 commits (make the five new SyncTransport methods abstract + stubs in SyncClientTest/SyncSignInTest; fake: JS-whitespace email regex, non-empty blob, 32-byte hash formats, confirmLost default now+24h, grace-branch test, move a comment in HttpSyncTransport.kt:41). Plan Task 4 amended: a stored unconfirmed claim under 1 hour old must not be replaced (the Worker's cooldown silently drops a new claim). Task 3 implementer (opus, agent a?) running. S1 experiment: owner chose "full S1" but placeholders still unfilled.
- 2026-11-11 (session 2): New owner request, "replace account key with email on login". Owner chose: an email code supplies the key (master password + emailed code on a new device; the account key stays inside the encryption but is delivered sealed under the emailed code; security tradeoff: master password + inbox opens the vault, no 24-hour wait; needs Worker changes), and chose to **finish email recovery first, then brainstorm and plan this as a separate spec** covering Worker, phone and extension. Not started.

- 2026-11-11 02:00 (session 2): Task 3 `ff033d9` + review fix round `2ac0b22` (449 tests, 0 failures; re-review: all 6 items ADDRESSED, verdict approve). Small queued leftovers for a later fix commit with Task 4's review fixes: N1 (in `EmailRecovery.enrol` save `before.copy(keyUnseen = true)` BEFORE calling `enrolEscrow`, restore `before` on null/exception), N2 (stale comment SyncSession.kt ~357-358 saying a lost reply is finished "by a sign-in"; `runCatching` at ~374 should catch `Exception` not `Throwable`). Task 5 must persist `keyUnseen` and `lostRequestedAt`, map enrol's `SyncAuthError`, run status on IO, and the New recovery key screen must call `keyShown()`. Task 4 (opus, OWNER lost) running. Email-login draft design committed `552556e`; owner questions pending (3).

- 2026-11-11 02:15 (session 2): OWNER INSTRUCTION: too many review agents, optimize. New policy: no per-commit review agents and no re-review agents for fix rounds (the controller verifies each commit itself: contents, a real test run, probes). Keep the one adversarial review already running for Task 4 (lost access, the riskiest code). After the last task, ONE whole-branch review. Fixes are batched. Task 4 `f542073` (466 tests); Task 5 implementer running (OWNER module).

- 2026-11-11 02:30 (session 2): Task 5 `06c28f4` (473 Kotlin, 83 TS tests; verified by controller). Task 4's adversarial review found C1 (lost reply + retry with a new claim orphans the first link: ~8-day lockout) and I1 (request stays pending forever after a successful open): fix round (resend the SAME stored claim; remove the cooldown and `lostRequestedAt`; best-effort cancel after open; `clearLost()` on normal unlock; plus Task 3 leftovers N1/N2) sent to the Task 4 agent. Task 7 (screens) running; it was told the copy requirements (hedge when no email arrives; only open the link if you asked just now). Next: verify the fix round myself, Task 8 (docs + gates), ONE whole-branch review.

- 2026-11-11 02:35 (session 2): ALL 8 plan tasks built. Task 7 `37782bf` (screens), Task 4 fix round `03012b7` (resend the same claim, cancel after open, clearLost, keyUnseen early), `75db65b` (clearLost off the unlock thread, controller), Task 8 docs `09de3e0`. Controller gates at HEAD: Gradle `:strongroom-vault:testDebugUnitTest :app:assembleDebug` 479 tests 0 failures 1 skipped (fresh XMLs) + debug APK built (NOT installed); `pnpm test` exit 0 (strongroom 83, extension 128, vault-api 53, core 159 ...); `pnpm typecheck` exit 0. ONE whole-branch review (opus) running. Not pushed, no PR, Worker not deployed, nothing installed on any phone. Owner-gated next: review findings -> fix batch -> owner go-ahead for Store build + device test (needs the Worker deployed with real PUBLIC_URL and confirmed MAIL_FROM), push, PR. Separate: email-login design draft `552556e` awaiting the owner's 3 decisions; S1 experiment awaiting placeholders.

## Current state and exact next step

**State (updated 2026-11-11, later)**: design approved, plan written and committed, awaiting owner's plan review and execution-method choice; nothing implemented; worktree exists (see session log). The next step is executing the plan (subagent-driven-development recommended) from Task 1. Older text follows:

**State (original)**: scoping complete, nothing implemented. No worktree exists yet for
this task (the `strongroom-extension-security` worktree at
`.claude/worktrees/strongroom-ext-security` is the *prior*, now-merged task —
don't reuse it; its branch is already merged into `main` via PR #29).

**Next step**: in the new chat, run `superpowers:brainstorming` to resolve the
four open design questions above (Escrow.kt placement/porting approach, UI
placement and copy, the sync-gating requirement, and background-check
behavior), producing a short design note to append to `docs/strongroom/
DESIGN.md` §11 the same way the extension's security hardening got its own
dated entry. Then `superpowers:writing-plans` for the task breakdown, then
execute with `superpowers:subagent-driven-development` in a fresh worktree
(e.g. `.claude/worktrees/strongroom-mobile-email-recovery`, branch
`strongroom-mobile-email-recovery`).
