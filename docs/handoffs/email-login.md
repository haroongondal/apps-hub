# Handoff: email-code sign-in for new devices (Worker done; extension and phone to do)

## Resume prompt (paste into a new chat)

```
Read docs/handoffs/email-login.md completely first. Trust the verified facts in it and do not re-derive them. Follow the same handoff contract: update the session log and "Current state" as milestones land; at ~85% context, stop starting work, rewrite the resume prompt with today's date, print it in a fenced block, and end the turn instead of letting auto-compaction happen. Multi-agent work uses cd-engineering-tools:parallel-agents-coord (never superpowers:subagent-driven-development). Owner rules: no Claude attribution in commits or PRs (no Co-Authored-By, no "Generated with" line); explicit `git add` pathspecs, never -A or .; never push, merge, release or deploy without the owner's go-ahead in that conversation; the live Worker is deployed only with a separate go-ahead; phone builds reach the phone through the Store, never adb install on the owner's phone; Cloudflare commands use `cf ... --profile personal`, never the default profile. Continue from "Current state and exact next step".
```

## Goal and fixed constraints
- Owner wants: sign in to the Strongroom extension and the Android app on a NEW device with the email address and master password, and a one-time code emailed to the owner. The account key is never typed and never emailed. (Owner chose this "middle path" on 2026-11-16 over email+password only, which would let a stolen server database be guessed offline.)
- Design decisions (binding): `docs/superpowers/specs/2026-11-11-email-login-decisions.md`. Background: `docs/superpowers/specs/2026-11-11-email-login-design-DRAFT.md` (the draft still says "owner decides"; the decisions file is the authority).
- No lockouts. A stranger must not be able to lock the owner out of the owner's own vault.
- Zero-knowledge: the Worker never sees the account key or the master password. It sees only hashes, ciphertext and the emailed code's hash-free form (the code itself is never stored server-side).
- Live Worker: https://strongroom-vault.haroonmukhtar4.workers.dev (personal Cloudflare account, D1 id in tools/vault-api/cloudflare.config.ts).

## Decisions made (with why)
1. Failed logins are serialised by a Durable Object (`LoginGate`), so only one failed attempt runs at a time, each with the existing exponential delay. Why: no lockout, and it slows scripted guessers. Known gap: a correct guess answers at once, so a guesser that fires in parallel and ignores timing is not slowed. Owner must decide whether to close that (see open decisions).
2. `SIGNIN_WAIT_HOURS` (vault-api config) is "0" = no wait (owner: "keep it off, we are in testing"). Set to 24 later for a cancellable wait. Code path exists for both.
3. A separate sign-in blob holding ONLY the account key, sealed under HKDF(emailed code, "strongroom/v1/signin"). Why: the existing escrow blob also holds the recovery key, and blob + code would then open the vault without the master password.
4. The owner gets an email on every sign-in request (device name, time, approve link, deny link). Never the blob or the code.

## Verified facts (do not re-derive)
- Worker commit `989fe50` on branch `extension-email-login` (worktree `.claude/worktrees/extension-email-login`). vault-api: `pnpm --filter @apps-hub/vault-api test` 87/87, typecheck clean, no bidi characters.
- Routes (tools/vault-api/src/index.ts):
  - POST /v1/signin/request {claimHash, deviceName?} -> {ok:true} always. claimHash = base64 SHA-256 of a 16-64 byte random claim (same as lost-access). Stores and mails nothing without a sign-in blob. One request at a time: a new claim is ignored while an unapproved request is under 1 hour old; an approved one can be replaced 1 hour after release; a denied one at once. Mail goes to the escrow email; device name cut to 60 chars with dots, colons, slashes, @, control and bidi characters removed.
  - POST /v1/signin/release {claim} -> {state:"ready", blob} | {state:"waiting", releaseAt} (releaseAt null while unapproved, and for denied/unknown/wrong claim). Never throws.
  - GET /v1/signin/approve?t= and GET /v1/signin/deny?t= show a form (no state change). POST /v1/signin/approve approves once (second POST: "already approved"); POST /v1/signin/deny denies. Separate tokens: a deny link cannot approve.
  - POST /v1/signin/cancel with a Bearer login, recovery or read token -> {ok:true} or 401.
  - PUT /v1/account takes an OPTIONAL `signin: {blob}` (base64), accepted only together with `escrow`; otherwise 400. A new sign-in blob deletes any open sign-in request. A changed recoveryHash without a new sign-in blob clears it; so does DELETE /v1/escrow. A PUT without `signin` leaves it.
- Migration `tools/vault-api/migrations/0003_signin.sql` (additive, new `signin` table). Live D1 (`cf d1 migrations list <id> --profile personal`, run from tools/vault-api): 0001 and 0002 applied, **0003 NOT applied yet**. Must be applied before deploying the Worker, or sign-in and the recovery calls return 500.
- Durable Object: class `LoginGate` exported from src/index.ts; config binding `LOGIN_GATE: bindings.durableObject({ worker: 'strongroom-vault', exportName: 'LoginGate' })` and `exports.durableObject({ storage: 'sqlite' })`. A local `cf build` produced it; NOT deployed. The queue lives in memory and is marked as a shortcut in the code.
- Live Worker today (version 9677f886, deployed 2026-11-11, PUBLIC_URL set): /v1/prelogin 200; /v1/lost/status 401 (route exists); /v1/escrow DELETE 401. It does NOT have the sign-in routes yet.
- Mail: the send_email binding's destination `haroonmukhtar4@gmail.com` is NOT a verified Email Routing destination (cf email-routing addresses list was empty on 2026-11-11). Every Worker mail fails with 502 until the owner verifies it in the Cloudflare dashboard. The Cloudflare token cannot read Email Sending domain status (403), so the sender domain (strongroom@haroongondal.com) is unverified too.
- PR #31 (PUBLIC_URL one-line change) was MERGED by the owner on 2026-11-15 (commit 8077525). Email-recovery PR #30 merged 2026-11-11 (f618796).
- Branch `extension-email-login` is 4 ahead, 5 behind origin/main (main is at d1b61ea, Inflow). Rebase onto origin/main before any PR.
- Extension suite: a 2-line test change is needed because apps/strongroom-extension/src/__tests__/sync-world.ts loads migrations 0001-0002 by name; 20 of 128 tests then get 500 once the Worker expects 0003. The earlier patch file was NOT saved (not found on 2026-11-16); recreate it: add the 0003_signin.sql migration to that loader, then run the extension suite.
- Semgrep: no literal bidi characters in tools/vault-api (fixed; the test uses an escape sequence).

## Owner answers to the open decisions (2026-11-16, binding)
1. Parallel guessing: ACCEPT the gap for now (testing). Revisit when SIGNIN_WAIT_HOURS goes to 24.
2. Refused device shown as "offline" after a long wait: FIX in the clients (extension and phone): a refusal shows "sign in again"; only a real network failure shows "offline".
3. Owner sync resets the failure count: KEEP.
4. Sign-in request slot: ONE ROW PER CLAIM, at most 5 live requests and at most 5 approval mails an hour (Worker change to the built single-row table; migration 0003 is not applied anywhere live, so it can still be edited).

## File map
- Worker (done): tools/vault-api/src/{index.ts,auth.ts,db.ts,lost-access.ts,login-gate.ts (or as named in 989fe50)}, migrations/0003_signin.sql, cloudflare.config.ts, package.json (test list), src/__tests__/{signin.test.ts,login-gate.test.ts}.
- Extension (to do): apps/strongroom-extension/src/service.ts (sign-in flow, a new "sign in with email" path that calls /v1/signin/request, polls /v1/signin/release, then asks for the code and master password, opens the sealed sign-in blob, and calls the existing sign-in with the account key), popup.ts/popup.html (email + password form, code entry, waiting screen with 'ask again'), enrolment must upload the sign-in blob (escrow PUT with `signin: {blob}`); tests in apps/strongroom-extension/src/__tests__/.
- Phone (to do): apps/strongroom/modules/strongroom-vault/android/src/main/java/expo/modules/strongroomvault/core/{EmailRecovery.kt,SyncSession.kt} and android/HttpSyncTransport.kt (sign-in blob on enrol, sign-in request/release), StrongroomVaultModule.kt, modules/strongroom-vault/src/index.ts, apps/strongroom/src/{SyncScreen.tsx,recovery-flow.ts}. The phone already has the account key in the Keystore, so it only needs the enrol upload; the new-device sign-in screen is the one that changes.
- Shared sealing: packages/strongroom-core/src (escrow.ts is the model; add a sign-in seal with the label "strongroom/v1/signin"; test vectors in apps/strongroom/tools/vectors/).

## Session log
- 2026-11-11: email recovery built, merged (PR #30) and released as versionCode 15. Worker routes deployed with migration 0002 and PUBLIC_URL (version 9677f886). Owner decisions recorded (1ddfdb1).
- 2026-11-11: Worker sign-in build committed (989fe50); decision-based changes; Semgrep bidi fix; handoff updated (b991fcf, 20f5df9).
- 2026-11-16: owner asked for a new-chat prompt to implement the middle path. Verified facts above; PR #31 found merged by the owner (2026-11-15); migration 0003 still pending on live D1; extension patch file missing (recreate).

- 2026-11-17: owner answered the four decisions (above). Rebased onto origin/main d1b61ea (config conflict: kept PUBLIC_URL + LOGIN_GATE + SIGNIN_WAIT_HOURS). Extension test loader now loads 0003 (128/128); root `pnpm test` exit 0. Worker sign-in requests are now one row per claim (UNIQUE claim/approve/deny hashes), at most 5 counted in an hour (made in the last hour, even if denied, or approved and within wait + 1 h grace); an unapproved request can be approved only within 1 h; an approved one releases until 1 h after its release time. vault-api 88/88. Residual: a stranger sending 5 requests an hour still fills the cap (owner chose the cap).
- 2026-11-17: core `sealSignin`/`openSignin` (escrow.ts) + `signin` vector section from escrow_vectors.py (venv in scratchpad; vault-vectors.json only gained `signin`) + transport `signinRequest/signinRelease/signinCancel` + `AccountUpdate.signin`. Extension: enrol uploads the sign-in blob; new request `emailSignIn` request/check/open (claim in settings `signinClaim`, released blob `signinBlob`, device name "Strongroom for Chrome"); popup "No account key? Sign in with your email code" screen. Decision 2 (TS): a token GET with no reply headers after 30 s while GET /v1/prelogin answers within 5 s throws SyncAuthError; else SyncOfflineError. core 166/166, extension 132/132, both typecheck clean.
- NOTE for the owner: an account enrolled in email recovery BEFORE this build has no sign-in blob; the request answers ok and mails nothing. Turn email recovery on again (re-enrol) once from a signed-in device after the update.
- 2026-11-17: read-only review (opus) of 0d6617b/23668e7/180d297/86a041f: 0 Important, 5 Minor, all fixed in 9df5762 (prelogin probe counts only 200/404; GET only; extension refuses "Ask again" on an approved claim; a released blob stays usable after the Worker forgets the request; two tests that could not fail). vault-api 88, core transport 14, extension 133.
- 2026-11-17: phone built by a native-module agent in 8d7cae3: Kotlin Escrow.sealSignin/openSignin, EscrowBody.signin rides the enrol PUT, transport signinRequest/Release/Cancel, EmailRecovery.signinRequest/Check/Open (prefs signinClaim/signinBlob, device "Strongroom for Android"), module functions emailSignInRequest/Check/Open, EmailSignInScreen.tsx + SyncScreen ghost button, HttpSyncTransport probe (GET with token, SocketTimeout, prelogin 200/404 -> SyncAuthError). Gradle :strongroom-vault:testDebugUnitTest :app:assembleDebug BUILD SUCCESSFUL (503 tests, 0 fail); strongroom 89/89. Fix round 1 (d242039): phone refuses "Ask again" on an approved claim (SIGNIN_APPROVED) and keeps a released blob. Review (opus) of the phone: 0 Important; fix round 2 (492499e): network-first and stalled-reply tests now fail without their guards, sign-in blob kept only on EscrowBody (wire JSON unchanged).
- 2026-11-17: closing gates on a clean tree at 492499e: root `pnpm test` exit 0, `pnpm typecheck` exit 0, `:strongroom-vault:testDebugUnitTest :app:assembleDebug` exit 0 (506 JVM tests, 0 fail).

## Current state and exact next step
- Done (branch `extension-email-login`, pushed, PR #36 open, nothing deployed): Worker per-claim requests, core seal + transport, extension email sign-in, phone email sign-in, decision-2 fix on both clients, two independent reviews with every finding fixed. Branch is based on origin/main d1b61ea; rebase again if main has moved.
- Owner action before it can work live: re-enrol email recovery once (turn it on again) from a signed-in device after the update; an account enrolled before this has no sign-in blob, and a sign-in request then mails nothing.
- Next, in order, each only with the owner's go-ahead in that conversation:
  1. DONE 2026-11-17: branch pushed, PR #36 opened (https://github.com/haroongondal/apps-hub/pull/36). Merging is the owner's call.
  2. Live Worker: apply migration 0003 to the live D1 (`cf d1 migrations apply <id> --profile personal` from tools/vault-api; check the exact command with `cf cli search` first), then the owner verifies `haroonmukhtar4@gmail.com` as an Email Routing destination and the sender domain in the Cloudflare dashboard, then deploy the Worker with a separate go-ahead.
  3. Phone release through the Store only (never adb install on the owner's phone); extension release through the Chrome Web Store flow in tools/webstore.
  4. Device check of the flow on the phone and in Chrome (qa-engineer), after the Worker is live: enrol -> new device request -> approve mail -> code + master password -> signed in; "Ask again" after approval refused; deny link stops it.
- Accepted residuals: parallel online guessing (decision 1); a stranger can fill the 5-per-hour request cap; a token GET stalled 30 s on a weak link while prelogin answers reads as "sign in again" (decision 2).
