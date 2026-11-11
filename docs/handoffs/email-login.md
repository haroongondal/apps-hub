# Handoff: email-code sign-in (new devices, extension and phone)

## Resume prompt (paste into a new chat)

```
Read docs/handoffs/email-login.md completely first. Trust the verified facts in it and do not re-derive them. Follow the same handoff contract (update the session log and current state as milestones land; at ~85% context, stop, rewrite the resume prompt with today's date, print it in a fenced block, and end the turn). Owner rules: no Claude attribution in commits or PRs; explicit `git add` pathspecs; never push, merge, release or deploy without the owner's go-ahead in that conversation; the live Worker is deployed only with a separate go-ahead; the Store (not adb) installs phone builds. Continue from "Current state" below.
```

## Goal and constraints
- Let a new device sign in with an email code and the master password, so the account key is never typed or emailed.
- Owner decisions: `docs/superpowers/specs/2026-11-11-email-login-decisions.md` (binding). Background: `docs/superpowers/specs/2026-11-11-email-login-design-DRAFT.md`.
- Live Worker: `https://strongroom-vault.haroonmukhtar4.workers.dev` (personal Cloudflare account; use `cf ... --profile personal`, never the default profile). Its D1 migration 0002 and a `PUBLIC_URL` deploy were done on 2026-11-11 (Worker version `9677f886`).
- Mail: Email Routing destination `haroonmukhtar4@gmail.com` is NOT verified yet, so every Worker mail fails with 502. Owner must verify it (dashboard) before any mail test.

## Decisions
1. Failed logins serialised by a Durable Object; no lockout.
2. `SIGNIN_WAIT_HOURS` variable, default 0 (no wait); 24 later.
3. Separate sign-in blob (account key only). Escrow blob stays as it is.
4. Owner gets an email on every sign-in request, with device name and time.

## Verified facts
- `tools/vault-api/src/auth.ts` delays failures with a global counter, but does not serialise them, so parallel guessing is not limited (lines 29-43).
- Live Worker has the lost-access routes (checked 2026-11-11: `/v1/lost/status` 401, `/v1/escrow` DELETE 401).
- `main` contains email recovery (PR #30, f618796); the phone release is versionCode 15.
- PR #31 (`vault-deploy-public-url`, one line: `PUBLIC_URL`) is open and not merged; it matches the deployed Worker.

## File map
- Branch `extension-email-login` (worktree `.claude/worktrees/extension-email-login`): spec decisions (`1ddfdb1`), this handoff.
- Worker to change: `tools/vault-api/src/{auth.ts,index.ts,lost-access.ts,db.ts}`, new migration `0003_signin.sql`, new Durable Object (not yet written).
- Extension (later): `apps/strongroom-extension/src/service.ts`, `popup.ts`.
- Phone (later): `apps/strongroom/modules/strongroom-vault/android/...` and `apps/strongroom/src/...`.

## Session log
- 2026-11-11: owner chose serialised logins, wait variable off, separate sign-in blob, owner notice on every request. Worker build started on the branch (agent a88fe4...). Owner asked for a graceful pause; agent asked to stop at a safe point and report.

- 2026-11-11 (paused): Worker build committed as `989fe50` (sign-in routes, sign-in blob on PUT /v1/account, migration 0003, LoginGate Durable Object, SIGNIN_WAIT_HOURS="0", tests). vault-api: 87 tests pass, typecheck clean, no bidi characters (Semgrep fix applied). Root `pnpm test` FAILS in apps/strongroom-extension: 20 of 128 tests get a 500 because its sync-world loads migrations 0001-0002 only. Fix is a two-line test change, saved at scratchpad/extension-sync-world-0003.patch (verified: 128/128 in a scratch copy); NOT applied (owner said pause).

## Open decisions for the owner
1. Parallel guessing: a correct token answers at once, so an attacker who treats "no quick answer" as wrong is not slowed. Closing that makes the token check wait its turn, which can delay the owner's own sign-in, against the no-lockout rule.
2. A refused device on a slow or attacked network can wait over 30 s and then show "offline" rather than "sign in again".
3. Each successful owner sync resets the failure count, giving an attacker 5 more free guesses.
4. One pending sign-in row: a stranger can take the slot every hour and block the owner's email sign-in.

## Deploy order
Apply migration 0003 to the live D1 before deploying the Worker, or the email-recovery and sign-in calls return 500.

## Current state and exact next step
- Done: decisions committed (`1ddfdb1`).
- Worker build finished at `989fe50` (see the log above). Tree clean.
- Next: (1) owner decides open decision 1 (and 2-4); (2) apply the two-line extension test patch and re-run root `pnpm test`; (3) extension UI and phone enrolment of the sign-in blob; (4) deploy only with the owner's go-ahead, after migration 0003 is applied and the mail destination is verified.
