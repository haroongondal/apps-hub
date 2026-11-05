# Handoff: Strongroom Phase 2, Cloudflare sync

## Resume prompt

Dated 2026-11-05. Strongroom is the owner's own-code password manager (Android app 0.1.1 merged; the
Chrome extension is built and committed locally as `c3da09c` on branch `strongroom-extension`, **not
pushed**). Phase 2, Cloudflare sync, is planned and **the owner approved the plan on 2026-11-05**: build it.

Read completely first, in this order: this file, `docs/strongroom/PHASE-2-PLAN.md` (the approved plan; its
Decisions, Protocol, Review Focus and Global Constraints bind the work), `docs/strongroom/DESIGN.md`
(§6 format, §10 sync, §11, §12 review gates), then skim `docs/handoffs/strongroom-extension.md` and
`docs/handoffs/strongroom.md` for the extension and Android facts. Trust the decisions and verified facts
and don't redo that work. Follow the handoff contract in `~/.claude/CLAUDE.md`: update the session log and
"Current state" as each task lands, and at about 85% context finalize this file, print a fresh resume
prompt in a fenced block and end the turn (no compaction).

Step 0, before any task: work in **your own worktree**, not the extension worktree. Another chat is
working in `/Users/outsentia/Documents/apps-hub/.claude/worktrees/strongroom-extension` on Chrome Web
Store publishing CI with uncommitted files there (`.github/workflows/strongroom-extension-store.yml`,
`apps/strongroom-extension/{scripts/,README.md,package.json,tsconfig.json}`, `AGENTS.md`): never edit,
stash, commit or revert them. Create the worktree with
`git worktree add /Users/outsentia/Documents/apps-hub/.claude/worktrees/strongroom-sync -b strongroom-sync c3da09c`
(enter it with EnterWorktree), copy `docs/strongroom/PHASE-2-PLAN.md` and `docs/handoffs/strongroom-sync.md`
from the extension worktree into it, and commit exactly those two with explicit pathspecs (never
`git add -A`; no `Co-Authored-By` or "Generated with" lines). Never edit `.claude/worktrees/strongroom-phase-1`
(another session's, the Android app) if it still exists.

Execution method: `superpowers:subagent-driven-development`, as the plan recommends (the owner approved the
plan without choosing; switch to `superpowers:executing-plans` only if they say "native"). Models used in
Phase 1: opus for crypto, merge, Worker auth, Keystore and platform tasks (here Tasks 1 to 6), sonnet for
screens and extension wiring, opus reviewers for crypto/merge/Worker. Test-first in every task; report
real command output only.

Rules that do not bend: commit on `strongroom-sync` as the plan's steps say, but **push, merge, release or
deploy only on the owner's explicit word in the chat** (a `git push` was denied by the auto-mode
classifier on 2026-11-05: the owner pushes, or says how); confirm the Cloudflare account with them before
any deploy and use the `cf` CLI; install on the phone only through the Store; adb on the phone only for
logcat, screenshots and uiautomator dumps with `-s <serial>`, debug builds only on an emulator
(`strongroom-task12`, emulator-5556, never the phone); no new third-party dependency without asking.

Your first message to the owner is short: the execution method you will use, that you are starting
Task 1, and nothing else unless you are blocked. Then continue from "Current state + exact next step".

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

## Current state + exact next step

State: Tasks 1 to 3 complete; Task 4 (account key and tokens in Kotlin) dispatched (opus). The owner has not pushed `strongroom-extension` or merged
anything.

**Next:** follow the ledger: resume at the first task without a `Task N: complete` line. Tasks 1 to 7 run
unattended; the owner-gated Task 8 (reviews, deploy, release, live checks) waits for their word at each step.
