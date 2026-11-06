# Handoff: Strongroom Phase 2, Cloudflare sync

## Resume prompt

Dated 2026-11-06. Strongroom is the owner's own-code password manager. **Phase 2 (Cloudflare sync) is built
and proven on the owner's phone; what is left is Task 8 of the plan: reviews, Cloudflare deploy, release
0.2.0 and live checks — every step only on the owner's explicit word in the chat.** The work is on branch
`strongroom-sync` in the worktree `/Users/outsentia/Documents/apps-hub/.claude/worktrees/strongroom-sync`
(HEAD `f2f73ce`, stacked on the UNPUSHED extension commit `c3da09c` on branch `strongroom-extension`).
Nothing is pushed, merged, deployed or released. Enter that worktree with EnterWorktree (path) and work only
there.

Read completely first, in this order: this file (above all "Task 8 deploy notes" and "Current state + exact
next step"); `docs/strongroom/PHASE-2-PLAN.md` Task 8 and its Global Constraints; `docs/strongroom/DESIGN.md`
§10–§12; the SDD ledger `.superpowers/sdd/PHASE-2-PLAN/progress.md` in the worktree (git-ignored: rulings
R1–R33 with what each costs if wrong, every deferred minor and its triage, the phone-queue history). Trust the
verified results in them (all gates green, the 6c phone proof passed, the final review and its fixes are
done) and don't redo that work. Follow the handoff contract in `~/.claude/CLAUDE.md`: update the session log
and "Current state" as each step lands; at about 85% context finalize this file, print a fresh resume prompt
in a fenced block and end the turn (no compaction).

Task 8 steps, each waiting for the owner's word: (1) read-only reviews (DESIGN §12.2): `security-engineer`
on `tools/vault-api` and the sync code in core and Kotlin (auth, backoff, header adoption, quarantine, the
account-key mix, and ruling R20: the loginToken at rest under the unlocked-device Keystore key),
`invariant-reviewer` on the branch diff against AGENTS.md, `supply-chain-risk-auditor` (no new dependency),
`docs-keeper`; fix confirmed findings test-first and re-run every gate. (2) Confirm the Cloudflare account
with the owner (personal `29ada9205500ff7931f09084daf89597`, pinned in `tools/vault-api/cloudflare.config.ts`);
use the `cf` CLI only, find D1 create/migrate/secret/deploy commands with `cf cli search`, and show the owner
the exact commands before running any. (3) Create the D1 database, apply `migrations/0001_init.sql` by hand,
set `SETUP_TOKEN` (`openssl rand -base64 32`, ≥ 32 chars; kept only in the git-ignored `.dev.vars`; call it
the "setup code" to the owner), deploy, smoke-test (`GET /v1/prelogin` → 404, `POST /v1/records` without a
token → 401, and json_each / RETURNING / upsert / a 100-upsert batch on real D1). (4) Put the Worker URL in
`SyncConfig.BASE_URL` and `apps/strongroom-extension/src/sync-url.ts` with a test that they are equal, and
delete the release manifest's INTERNET removal (`manifest.test.ts` requires the pair). (5) Release only on the
owner's word: they push (a `git push` was denied by the auto-mode classifier before; ask how), the extension
PR merges first, then `git rebase --onto origin/main c3da09c strongroom-sync` if it was squashed; mind the
`security-fixes` branch's second vault-module job service (ClipboardClearJob) in `manifest.test.ts`; merge
with `[skip ci]`, then `pnpm release strongroom` (0.2.0) locally; the owner installs from the Store. (6) Live
checks with the owner (DESIGN/plan Task 8 Step 6). (7) Update `docs/handoffs/strongroom.md` and
`docs/handoffs/strongroom-extension.md`.

Rules that do not bend: commit with explicit pathspecs, never `git add -A`, no `Co-Authored-By` or
"Generated with" lines; the worktree sandbox refuses compound shell commands around git, so keep git commands
plain; no new third-party dependency without asking. **Phone:** the owner's real vault is the Store-installed
`com.haroon.strongroom` — never replace, clear or uninstall it; releases reach it only through the Store.
Before any adb on the phone (USB serial `49kjmnuwonkffqzh`, always `adb -s`), claim it with coord
(`~/.claude/plugins/cache/claude-coord/coord/1.0.0/bin/coord claim device:49kjmnuwonkffqzh "<what for>"`),
release it when done and message the next session; while only waiting off-device, or while fixing bugs
found in testing, lend it to the next session (`coord lend`/`coord back`) and ask for it back; no
`uiautomator dump` on the phone; don't change phone settings without asking (the owner allowed
`svc power stayon usb` during a test, reset to off afterwards).

Your first message to the owner is short: that Phase 2 is built and proven, and ask which Task 8 step to
start (suggest step 1, the read-only reviews). Then continue from "Current state + exact next step".

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

- 2026-11-06 (Task 8 session): owner said "start from step 2 and then do everything in order" (step 1,
  the reviews, skipped on the owner's word). Step 2 done: `cf` 1.0.0-beta.21 is signed in to the personal
  profile and sees only account `29ada9205500ff7931f09084daf89597`; no D1 databases; only Worker
  `apps-hub-store`. Commands found with `cf cli search` (below). `.dev.vars` written (SETUP_TOKEN, 44 chars,
  mode 600, git-ignored); `cf deploy --dry-run --secrets-file .dev.vars` builds (bindings DB + SETUP_TOKEN).
  **`cf d1 create` was DENIED by the auto-mode classifier** ("Modify Shared Resources") even with the
  owner's go: the owner must approve the Cloudflare commands explicitly or run them. Step 4 done ahead of the
  deploy (`35f56a5`): URL `https://strongroom-vault.haroonmukhtar4.workers.dev` (subdomain from
  `STORE_API_URL` in `~/.config/apps-hub/release.env`) in `SyncConfig.BASE_URL` and `sync-url.ts`,
  build.test.ts checks they are equal, release manifest keeps INTERNET, e2e builds its own no-server
  extension. Gates: extension 70, strongroom 61, typechecks, Gradle 376/0 + assembleDebug +
  assembleRelease, aapt2 release = Phase 1 + INTERNET, URL in the dex, e2e 56/56.

## Task 8 deploy notes

- **Commands (found 2026-11-06 with `cf cli search`; run in `tools/vault-api`):**
  `cf d1 create --name strongroom-vault` → `cf d1 migrations apply <id> --dir migrations` (adds a
  `d1_migrations` bookkeeping table, harmless) → `cf deploy --secrets-file .dev.vars` (= `pnpm run deploy`;
  the D1 binding is by name, deploy's `--provision` defaults on). If deploy makes a second database, put
  `id:` in `bindings.d1(...)`.

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

State (2026-11-06): **the build is done; Task 8 waits for the owner.** Branch `strongroom-sync`, HEAD
`c63735f`, from `c3da09c` (the unpushed extension commit). Nothing pushed, merged, deployed or released.

- Tasks 1–7 complete, each reviewed (opus for crypto/merge/Worker/Keystore, sonnet for screens/extension),
  with fix rounds; the final whole-branch review, its one fix wave and the owner-approved residual fix are
  done and re-reviewed clean. Gates at the end: Gradle 376 (0 failures), strongroom 61, strongroom-core 142,
  vault-api 20, extension 69 + Chromium e2e 56/56, all typechecks; release APK = Phase 1 permissions only
  (`446ca9f`, from an owner-approved security review in another session, removes INTERNET again until Task 8
  sets `SyncConfig.BASE_URL`).
- **Phone proof (6c) passed on the owner's phone** (side-by-side test app, local HTTPS Worker): 0.1.1 upgrade,
  wrong setup code leaves the vault as it was, turn on sync (key shown once, type-back), add/sync, fresh-device
  sign-in, locked download staged then merged, wrong password/key copy, list refresh, on-disk check 0 hits for
  17 secrets. Test app uninstalled, phone released in coord.
- Deferred minors (none blocking; triaged CAN WAIT / SHOULD FIX in the ledger): e.g. hardware Back from Show
  account key leaves Sync; a cert failure reads "could not be reached"; a refused setup code leaves encrypted
  sync files; NEEDS_SIGN_IN copy after a local reset; `updateAccount` fallbacks after a double failure.
- Merge note: branch `security-fixes` adds a second private job service (ClipboardClearJob) to the vault
  module; our manifest.test.ts must allow it when the branches meet. Rebase onto `origin/main` once the owner
  has merged the extension PR (`git rebase --onto origin/main c3da09c strongroom-sync` if squashed).

**Update 2026-11-06 (Task 8 session):** step 1 skipped on the owner's word; step 2 done; step 4 done
(`35f56a5`); step 3 blocked: `cf d1 create` denied by the auto-mode classifier, waiting for the owner to
approve the Cloudflare commands or run them. Next: step 3 (create D1, migrate, deploy, smoke test), then 5–7.

**Next (each step only on the owner's word):** Task 8 per the plan and the "Task 8 deploy notes" above:
1. reviews (security-engineer on vault-api + sync code; invariant-reviewer; supply-chain; docs-keeper);
2. confirm the Cloudflare account (personal `29ada9205500ff7931f09084daf89597`), find the `cf` commands with
   `cf cli search`, show them; 3. create D1, apply the migration by hand, set SETUP_TOKEN (≥ 32 chars, the
   "setup code"), deploy, smoke-test (incl. json_each/RETURNING/upsert/100-upsert batch on real D1);
4. set `SyncConfig.BASE_URL` + `sync-url.ts` (test they are equal) and delete the release INTERNET removal;
5. push/merge with `[skip ci]`, then `pnpm release strongroom` (0.2.0), owner installs from the Store;
6. live checks with the owner; 7. update `docs/handoffs/strongroom.md` and `strongroom-extension.md`.
