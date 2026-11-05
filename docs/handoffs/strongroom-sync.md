# Handoff: Strongroom Phase 2, Cloudflare sync

## Resume prompt

Dated 2026-11-05 (rewritten at the end of build session 1). Strongroom is the owner's own-code password
manager. Phase 2, Cloudflare sync, was approved on 2026-11-05 and is being built on branch `strongroom-sync`
in the worktree `/Users/outsentia/Documents/apps-hub/.claude/worktrees/strongroom-sync` (from the unpushed
extension commit `c3da09c`). Enter that worktree with EnterWorktree (path) and work only there.

Read completely first, in this order: this file; the SDD ledger
`.superpowers/sdd/PHASE-2-PLAN/progress.md` in the worktree (git-ignored: every ruling R1–R27, every
deferred minor, every carry-forward note, the phone queue, and which tasks are complete — trust it and
`git log` over memory); `docs/strongroom/PHASE-2-PLAN.md` (Decisions, Protocol, Review Focus, Global
Constraints bind the work); `docs/strongroom/DESIGN.md` §6, §10–§12. The per-task briefs and reports are in
`.superpowers/sdd/PHASE-2-PLAN/` (task-N-brief.md, task-N-report.md, task-6a/6b/7a-brief.md). Trust the
decisions and verified facts; don't redo finished tasks. Follow the handoff contract in `~/.claude/CLAUDE.md`
(update the session log and "Current state" as work lands; at about 85% context finalize this file, print a
fresh resume prompt in a fenced block and end the turn, no compaction).

Execution: `superpowers:subagent-driven-development` (its scripts are refused by the worktree sandbox: write
briefs with `sed -n 'a,bp' plan > brief`, review packages with `git diff -U10 BASE HEAD > file`, keep git
commands plain and separate). Models: opus for crypto/merge/Worker/Keystore/platform and their reviewers,
sonnet for screens and extension wiring (and their reviewers when the diff is UI-only). Test-first; real
command output only. Briefs and reports go through files; implementers never spawn subagents.

Rules that do not bend: commit on `strongroom-sync` with explicit pathspecs, no `Co-Authored-By` or
"Generated with" lines; **push, merge, release or deploy only on the owner's explicit word in the chat**;
confirm the Cloudflare account before any deploy and use the `cf` CLI; no new third-party dependency without
asking. **Phone (owner, 2026-11-05):** test 6c on the owner's phone (USB serial `49kjmnuwonkffqzh`, always
`adb -s`), not the emulator; `adb install` of a SIDE-BY-SIDE test build with its own applicationId only
(ruling R26) — never replace, update or uninstall the Store-installed `com.haroon.strongroom` (the real
vault); no `uiautomator dump` on the phone; no phone settings changes. **Phone queue:** apps-hub-63 is on the
phone and will message `strongroom-sync-dc` (the old session's name) "phone free" — a new session must first
tell apps-hub-63 its own name (ListAgents shows it) and ask to be messaged instead; after 6c send "phone free"
to **apps-hub-ad** (Model Host; leave `/data/local/tmp/mb` and `svc power stayon usb` alone). Never
`adb logcat -c` or touch `com.haroon.designeditor` while another session holds the phone.

Your first message to the owner is short: where you are resuming (task and state from the ledger) and what
you start now. Then continue from "Current state + exact next step".

## Goal and fixed constraints

- The phone and the Chrome extension share one vault through a Worker on the owner's own Cloudflare
  account, which only ever holds ciphertext, plus an account key so a leaked D1 can't be guessed offline.
- Anti-goals (DESIGN §4): no password or key reaching a third party readable; never fill a lookalike;
  never lose or corrupt the vault (a bad merge or failed sign-in must leave the old vault intact).
- The vault format stays byte-compatible: record bytes, header layout and existing vectors don't change.
- Repo rules: `@apps-hub/ui` only for UI, erasable TypeScript with `.ts` imports, `node --test` listed
  per package, Kotlin JVM tests for vault logic, no telemetry, FOSS only, sentence-case copy.
- Full list: "Global Constraints" in the plan.

## Decisions made (with why)

All in the plan's "Decisions"; the owner delegated them on 2026-11-05 ("do what you think is best").

- **Account key, mixed in right after Argon2id and before the HKDF split.** The server stores
  `SHA-256(loginToken)`, so a key mixed only into the wrap would leave that hash as a second offline
  guessing check. 20 bytes (not DESIGN's 128-bit) so the recovery-key encoder is reused; this deviates
  from DESIGN's wording and Task 1 records it there.
- **Optional header flag `accountKey: true`, no version bump,** so unflagged headers stay byte-identical.
- **The extension signs in and replaces its vault** (with an entry-count confirmation); it holds
  throwaway logins only. The phone creates the account (one-time `SETUP_TOKEN`).
- **Phase 2 stacks on the extension branch** (`strongroom-sync` from `c3da09c`) because the push was denied;
  rebase onto `origin/main` once the owner has merged the extension PR (`git rebase --onto origin/main
  c3da09c strongroom-sync` if squashed).
- **Release:** Phase 2 changes `apps/strongroom`, so a merge to `main` releases Strongroom: merge with
  `[skip ci]`, then `pnpm release strongroom` locally on the owner's word (memory: release-by-local-command).
- **Re-key is not in this plan** (DESIGN §10 says Phase 2 adds it): proposed as a Task 9 later.

## Evidence / facts already verified (2026-11-05)

- `origin/main` was still `ec23cbd` (the extension branch base). `node tools/release/src/changed.ts
  origin/main` on the extension branch prints no apps: `apps/strongroom` depends only on `@apps-hub/ui` and
  `strongroom-vault`, not on `strongroom-core`.
- `strongroom-core`: 85 tests pass; extension service tests 27 (the other chat has since added Web Store
  tests, 41 in that package); `typecheck` clean for both. The root `pnpm test` can't run in the extension
  worktree (root `node_modules` empty, only the two Strongroom packages installed): CI is the full gate.
  A first root run failed because pnpm started an install mid-run; `store-manifest` passes alone (4/4).
- Current TS code: `Header = { version, kdf, salt, passwordWrap, recoveryWrap }`, version 1 only,
  `MAX_HEADER_CHARS = 4096`; `passwordWrapKey = hkdf(argon2id(...), 'strongroom/v1/wrap')`; `hkdf` has no
  salt parameter yet; `RecordStore { getHeader, getRecords, commit({ header?, records? }) }`;
  `Deleted` tombstone entries and `updatedAt` already exist in `entry.ts`.
- Current Kotlin code: `RecordStore { header(), putHeader(json), all(), putAll(map) }`; an internal
  `Crypto.hkdf(ikm, salt, info, length)` overload with a salt exists; `SqliteRecordStore` is schema 1
  (`header(k,v)`, `records(id, sealed)`); the module's only test dependency is JUnit 4 (no Robolectric).
- `vault-vectors.json` (`apps/strongroom/modules/strongroom-vault/android/src/test/resources/`) already
  holds `loginToken` for the password and recovery paths; TS tests read it through
  `packages/strongroom-core/src/__tests__/vectors.ts`. No `readToken` vector yet.
- The common-password check **exists in the Android app** (`apps/strongroom/src/common-passwords.ts`, 10
  entries of 12+ characters from the SecLists 10k, used by `forms.ts:16`); the extension lacks it. The
  earlier handoffs said "neither": that was wrong.
- `INTERNET` is in the main Android manifest and removed in release by
  `apps/strongroom/android/app/src/release/AndroidManifest.xml` (`tools:node="remove"`): Task 6 deletes the
  override.
- `tools/store-api` pattern: `cloudflare.config.ts` with account `29ada9205500ff7931f09084daf89597`
  (personal), `cf` 1.0.0-beta.21, `@cloudflare/vite-plugin` 2.0.0-beta.v.4, `vite` ^8.3.5. `cf` is **not
  installed** in the extension worktree, so the D1 binding helper name in `cf/config` is unverified (plan
  Task 2 Step 3 says to look it up).
- Node v22.23.4: `node:sqlite` loads (prints an ExperimentalWarning), enough for the Worker's D1 test fake.
- `.git/info/exclude` hides `/strongroom-extension-dist/` (a snapshot the owner loads unpacked; it is not
  Phase 2's concern). No Chrome profile showed the extension loaded as of 2026-11-05.

## File map

- Plan: `docs/strongroom/PHASE-2-PLAN.md` (8 tasks; file map inside).
- Design: `docs/strongroom/DESIGN.md`. Other handoffs: `docs/handoffs/strongroom.md` (Android),
  `docs/handoffs/strongroom-extension.md` (extension; another chat is editing it, read only).
- Core: `packages/strongroom-core/src/{crypto,format,vault,entry,recovery-key}.ts`.
- Kotlin: `apps/strongroom/modules/strongroom-vault/android/src/main/java/expo/modules/strongroomvault/{core,android}/`.
- Worker pattern: `tools/store-api/`. Release: `tools/release/src/{apps,changed}.ts`, `.github/workflows/ci.yml`.

## Session log

- 2026-11-05 (planning session): read the three docs, verified the facts above, committed the extension
  as `c3da09c` locally (push denied), wrote the plan, corrected the common-password claim, owner approved
  the plan and asked for this handoff and a new-chat prompt. No Phase 2 code exists yet.
- 2026-11-05 (build session 1): Step 0 done: worktree `.claude/worktrees/strongroom-sync` on branch
  `strongroom-sync` from `c3da09c`, docs committed as `94b6239`; `strongroom-core` deps installed.
  Execution: subagent-driven-development. Its ledger (pre-flight scan, rulings R1 to R5, per-task
  progress) is `.superpowers/sdd/PHASE-2-PLAN/progress.md` in the worktree (git-ignored): read it on
  resume, it says which tasks are done. argon2-cffi is not installed on the Mac; vectors use a scratchpad
  venv (R1). The worktree sandbox refuses compound shell commands that might run git: keep git commands
  plain and separate.
- 2026-11-05: **Task 1 done** (`8ea3c25`): account key, `openWithPassword`, `tokenHash`, `withAccountKey`,
  header flag (last field), vectors from `apps/strongroom/tools/vectors/account_key_vectors.py`
  (argon2-cffi + cryptography in a scratchpad venv). strongroom-core 85 → 95 tests. Opus review approved;
  the reviewer recomputed the vectors with node:crypto.
- 2026-11-05: **Task 2 done** (`4da6217`): `tools/vault-api` Worker (D1 binding `bindings.d1({ name })`,
  WebCrypto hashing, imports only `strongroom-core/src/sync/protocol.ts`), `sync-samples.json`, 17 tests on
  a node:sqlite D1 fake. Not deployed, no `cf` command run. Opus review approved. Deploy notes for Task 8:
  `SETUP_TOKEN` must be ≥ 32 characters; smoke-test `json_each`, `RETURNING`, upsert and a 100-upsert
  batch on real D1; the migration is applied by hand (no migrations option in `cloudflare.config.ts`).
  `ifRev` is required on an account update (ruling R7).
- 2026-11-05: **Task 3 done** (`5d71565..1630c65`): `packages/strongroom-core/src/sync/` (transport, merge,
  header-adopt, client, signin) + `sync-e2e.test.ts` against the real Worker. Core 136 tests, vault-api 20.
  Rulings R8 (account update keeps the recovery hash when omitted; turning sync on asks for the recovery
  key), R9 (oversize entry skipped and reported, never blocks others), R10 (header adopted at the next
  password unlock/sign-in), R11 (unreadable local record kept, never overwritten or pushed), R12 (sign-in
  reports unreadable rows), R13 (server reply shapes checked). The opus review found a critical livelock
  (a locally-won conflict whose push failed never kept its base rev → 409 forever); fixed with
  `MergePlan.rebase` in the same atomic `applyPull` as the `lastRev` advance, in three fix rounds.
  The rules Kotlin must copy are listed at the end of `.superpowers/sdd/PHASE-2-PLAN/task-3-report.md`.

- 2026-11-05: **Task 4 done** (`fe8520d`): Kotlin account key, `derivePasswordKeys(…, flagged)`,
  `openPasswordWrap`, tokens, `tokenHash`, flagged header JSON (last field). Gradle 271 → 283, 0 failures;
  `VectorGen` keeps `vault-vectors.json` byte-identical. Opus review approved (vectors recomputed in Python).
  Vault.kt still passes no account key: Task 6 wires it. Ruling R16: `applyPull` adopts only if the local
  bytes are unchanged since the snapshot (Kotlin in Task 5, TS + extension in Task 7).

- 2026-11-05: **Task 5 done** (`0811245`): Kotlin `SyncMerge`, `SyncClient` (+ `adoptHeader`, sign-in),
  `SyncProtocol` (wire decoders), schema 2 in `SqliteRecordStore` (rev, dirty, meta, quarantine; upgrade
  marks every record dirty), R16 guard in one transaction with the `lastRev` hold-back. Gradle 283 → 326.
  Opus review approved. `key-check` (non-UUID) never leaves the phone. Task 6 is split 6a/6b/6c (R17); the
  locked job stages downloads in a `pending` table merged at unlock (R18).

- 2026-11-05: **Task 6a built** (`28b7e58`, under opus review): HttpSyncTransport, SyncKeys, SyncJobService,
  SyncConfig (BASE_URL empty), SyncSession orchestration, module API (`syncStatus` with `available`,
  `enableSync(setupToken, password, recoveryKey)`, `showAccountKey`, `signInSync`, `recoverSync`,
  `syncNow`, `onSync`), release manifest keeps INTERNET. Gradle 326 → 350; release APK = Phase 1 permissions +
  INTERNET. Rulings: R19 job has no network constraint and is not persisted (no new permission); **R20
  (provisional, for the owner and Task 8's security review): the loginToken is stored under the
  unlocked-device Keystore key so a fingerprint unlock can upload**; R22 a 409 on an account update → "sign
  in again" (copy must say the change may not have reached other devices).
- 2026-11-05: **Task 6a done** (`28b7e58..cb9d2b2`): opus review found that a locked download while a
  password change was unsent would force a sign-in that undoes the change; fixed (download waits while an
  account update is pending), plus: sign-in refuses a server header without the account-key flag, coded
  errors, `SyncKey.seal` throws instead of silently replacing a key, password copy wiped at lock, offline
  job runs are not errors, `recoverSync(recoveryKey, newPassword, accountKey?)` takes an optional typed key
  (supersedes R21). Gradle 358 tests. R25 supersedes R23: the device proof serves the local Worker over HTTPS
  with a cert trusted only by a debug-only network security config, plus a debug BASE_URL override.
- 2026-11-05: **owner changed 6c: test on the PHONE, not the emulator** (the emulator causes problems on
  the Mac); `adb install` allowed, but only after the session using the phone says "phone free". Ruling R26:
  install a SIDE-BY-SIDE test build with its own applicationId (Gradle property suffix, default empty);
  never replace, update or uninstall the Store-installed `com.haroon.strongroom` (the owner's real vault).
  Phone USB serial `49kjmnuwonkffqzh` (always `adb -s`). No `uiautomator dump` on the phone. Phone queue:
  apps-hub-63 (Design Editor, testing now; will message **strongroom-sync-dc** "phone free") → this work
  (6c) → **apps-hub-ad** (Model Host benchmarks, 3–4 h idle on USB; send it "phone free" when 6c is done;
  leave `/data/local/tmp/mb` and `svc power stayon usb` alone).

## Task 8 deploy notes

- **Give release builds INTERNET back.** Security review, 2026-11-06: until `SyncConfig.BASE_URL` is set,
  `apps/strongroom/android/app/src/release/AndroidManifest.xml` removes `INTERNET` again, so a bad
  dependency can't send secrets out of a release build with no sync server. When Task 8 sets `BASE_URL`,
  delete that `uses-permission` line; `manifest.test.ts` fails until the two agree.
- **Setup code.** The Worker's `SETUP_TOKEN` secret must be at least 32 characters; the Worker refuses a
  shorter one as if none were set. Make it with `openssl rand -base64 32` (44 characters). Call it the
  **setup code** when talking to the owner: that is the name on the phone's Turn on sync screen. It is
  typed once on the phone and works once, ever.
- **Real D1 smoke test before the phone uses it.** The tests run on a node:sqlite D1 fake, so check on the
  deployed database what the fake can't prove: `json_each` (the push's conflict check), `RETURNING` (the
  revision counter, the account update and the auth counter), the upsert (`ON CONFLICT … DO UPDATE`) and
  one push of 100 upserts (the batch limit).
- **The migration is applied by hand.** `cloudflare.config.ts` has no migrations option, so run
  `tools/vault-api/migrations/0001_init.sql` against the new D1 database once, before the first request
  (find the `cf` subcommand with `cf cli search`; the account is the personal one pinned in that file).

## Current state + exact next step

State (2026-11-05, late): Tasks 1–5, 6a and 7a complete (7a `f4f9790`: R16 guard + lastRev hold-back in
TS, vault.ts account key, sign-in refuses a dropped flag; opus approved). 6b (screens, `3b10bd5`) reviewed:
**fix round 1 queued** (double-counted "not synced" footer + copy fixes, ruling R28; resume/redo from
`task-6b-report.md` and the ledger's 6b lines). 6c (phone proof, opus) is doing the OFF-PHONE prep only
(side-by-side build property, debug-only FLAG_SECURE switch, HTTPS harness, debug network config + BASE_URL
override, both test APKs, disk-check update) and will report BLOCKED "waiting for the phone": the owner gave
the phone back to apps-hub-63, which will send "phone free" to strongroom-sync-dc. 7b brief is ready
(`task-7b-brief.md`, rulings R29 and the vault.ts `keyed` gate).
Update: 6c off-phone prep is DONE (`561f1a8`: side-by-side test app `com.haroon.strongroom.synctest`,
debug-only screenshot switch, HTTPS harness `tools/vault-api/src/local-https.ts` + second-device script
`local-device.ts`, debug network config + BASE_URL override, disk-check update; release APK byte-identical).
Both test APKs and the throwaway c3da09c worktree are in the old session's scratchpad (`…/scratchpad/6c/`);
if a new session can't see them, rebuild per `task-6c-report.md`. Phone checks a–h wait for the phone: on
the owner's word the phone went to **apps-hub-ad** (Model Host, ~3–4 h), which will send "phone free" back
(owner's rule: hand the phone on while only waiting off-device; memory `phone-queue-handoff`). 6b fix round
6b is complete (`3b10bd5..ad95198`, two fix rounds; strongroom 59 tests). **7b is complete**
(`1b99210..46b4254`, one fix round: honest sign-in copy, recovery serialized with sync, sign-in from the
unlock screen, account-key typo guard, true "stays on this computer" copy; extension 69 tests, Chromium e2e
55/55). **All code tasks are done.** The final whole-branch review (opus) found 2 Important + 6 Minor;
the one fix wave (`a0bc58e`, `1e19046`, `3082b04`) addressed all nine items (Gradle 369, strongroom 61,
extension 69 + e2e 56, core 142, vault-api 20; release = Phase 1 + INTERNET). Its re-review found ONE
residual Important (overlapping password/recovery-key changes + a crash in the new bookkeeping can upload a
header no device can sign in to), **fixed on the owner's "go ahead" (2026-11-06) in two rounds**
(`9239d47`, `ef89ccd`: mark saved before the new tokens; NEXT_* via the KEY_LOST-safe store; a new recovery
key sends tokens matching its header; Gradle 376). Re-review clean; three minors deferred in the ledger.
Remaining: 6c phone checks a–h
when apps-hub-ad sends "phone free" (resume per `task-6c-report.md`; then "phone free" to apps-hub-ad or
whoever the queue says); then stop for the owner (Task 8, each step on their word; deploy notes are in
this file) with the "Rulings I made" list from the ledger. The SDD ledger `.superpowers/sdd/PHASE-2-PLAN/progress.md` has every ruling,
deferred minor and carry-forward note. The owner has not pushed `strongroom-extension` or merged
anything.

**Next:** follow the ledger: resume at the first task without a `Task N: complete` line. Tasks 1 to 7 run
unattended; the owner-gated Task 8 (reviews, deploy, release, live checks) waits for their word at each step.
