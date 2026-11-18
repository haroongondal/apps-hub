# Strongroom: sign in on a new device with email instead of the account key

**Status: DRAFT for owner decision, not approved.** Written 2026-11-11 on branch `strongroom-mobile-email-recovery`. Nothing here is built, and nothing should be until the in-flight email-recovery work is merged (owner's order).

Line numbers are from this branch on 2026-11-11. `SyncSession.kt` is being edited by other agents, so its line numbers may have moved.

## Read this first

1. **Reusing the existing escrow blob for sign-in is unsafe.** That blob holds the recovery key as well as the account key (`packages/strongroom-core/src/escrow.ts:12-15`, `core/Escrow.kt:14-24`). The recovery key alone signs in and opens the vault (`sync/signin.ts:56-62`, `format.ts:144-147`), and recovery then sets a new master password. If a new device could fetch that blob without the 24-hour wait, **anyone who controls the inbox would get the whole vault at once, with no master password and no wait.** I checked this with a probe against `strongroom-core`: blob plus code opens the vault, while the password alone is refused with "This vault needs its account key". Email sign-in needs its own blob that holds **only the account key**.
2. **A new code emailed for every sign-in can't safely supply the account key.** To seal the account key under a code it just made, the Worker has to hold the account key (or a key that opens it). That makes Cloudflare one of the two secrets, which is option C below. The safe version is a code your **device** made once and you **keep in your inbox**. It is 32 characters, the same length as the account key. So email sign-in doesn't save typing (you can paste it). What it saves is having to store the key somewhere yourself.
3. **Every email option means inbox + master password = the whole vault, at once.** Today an attacker with both still has to wait 24 hours through email recovery, and you can cancel during that time. This is the main cost of the request, and you should decide on it deliberately (question 1).
4. **I found a gap that exists today and becomes real once the account key can leave by email.** The failed-sign-in backoff slows down each refused request on its own. It doesn't limit how many requests run at the same time (`tools/vault-api/src/auth.ts:29-43`, `index.ts` has no other gate). Today that doesn't matter, because without the account key a guess is a guess at a 256-bit token. With the account key, someone who has it can guess the master password online in parallel, limited only by Cloudflare's request quota. (I read the code but didn't load-test it.)

## 1. What was asked, and what the code does today

The owner asked to "replace account key with email on login" and chose "Email code supplies the key": signing in on a new device takes the master password plus a code from email, instead of typing the 20-byte account key.

How keys work today:
- The account key is mixed in after Argon2id and **before** the HKDF split, so the wrap key, the login token and the read token all depend on it: `format.ts:84-90` (TS) and `VaultFormat.kt:171-174` (Kotlin), as specified in DESIGN.md §10 "Account key".
- `derivePasswordKeys` throws `AccountKeyRequired` for a flagged header that has no key (`format.ts:122`). `withNewPassword` does too (`format.ts:168`). So a new device **without the account key can't compute a login token and can't authenticate at all**, and it also can't finish a recovery-key reset, because that rewraps `passwordWrap` and needs the key.
- `GET /v1/prelogin` is public and returns the salt, the KDF parameters and the flag (`index.ts:90-94`). Every other route that matters needs a bearer token whose SHA-256 is in D1 (`auth.ts:15-27`).
- Sign-in today: `signInWithPassword(transport, password, accountKey)` (`sync/signin.ts:45-54`). Callers: extension `service.ts:589-600`, phone `SyncSession.signIn` (`SyncSession.kt:147-159`), phone form fields `sync-flow.ts:177` (`signIn: ['password', 'accountKey']`), extension popup `popup.ts:116-117`.
- Email recovery (in flight on the phone, built in the extension): the client makes a 160-bit code and seals `recoveryKey || accountKey` under `HKDF(code, "strongroom/v1/escrow")`. `PUT /v1/account` carries `{email, blob, code}`, and the Worker mails the code **before** it writes anything (`index.ts:105-111`). The blob is released only by `POST /v1/lost/release`, after a mailed confirm link and a 24-hour wait (`lost-access.ts:64-77`). A new recovery key deletes the escrow (`index.ts:118-120`).

So the caller's crux holds. (1) A new device can't authenticate. (2) If the Worker makes a fresh code each time, the Worker must hold the account key. (3) The only shape that keeps the Worker blind is a code made on the client at enrolment and sealed there. Point 3 needs one correction: the sealed blob must not be the existing escrow blob (see "Read this first", item 1).

## 2. Options

Attacker cases: **(a)** D1 leak only; **(b)** D1 leak + phished master password; **(c)** control of the inbox only; **(d)** inbox + master password. I added **(e)**, takeover of the Cloudflare account (D1 plus Worker secrets plus the ability to deploy), because it is the case that separates C from B. "Online guessing" means guessing the master password against the Worker with the account key in hand.

| Option | (a) D1 | (b) D1 + password | (c) inbox | (d) inbox + password | (e) Cloudflare takeover | Cost |
|---|---|---|---|---|---|---|
| **Today** (typed key, email recovery on) | nothing, no offline guessing | nothing | whole vault **after 24 h**, unless the owner cancels | same as (c) | nothing offline; catches code + blob at the next enrolment (accepted exception, DESIGN §4) | — |
| **A.** Reuse escrow blob, fetchable at sign-in | nothing | nothing | **whole vault at once, no password** | same | whole vault | tiny; **unsafe** |
| **B.** Sign-in blob (account key only), same email code, released after a mailed approval link | nothing | nothing | account key at once, then online guessing only; the recovery path still waits 24 h | **whole vault at once** | same as today | 1 migration, ~5 routes, both clients, vectors; no vault-format change |
| **B0.** As B, but the blob is public (no approval link) | nothing | nothing | as B; an old copy of the code email (no live inbox) also works | as B | same as today | B minus the approval routes and UI |
| **C.** Worker holds the account key under a Worker secret and mails a fresh short code each sign-in | nothing (if the secret isn't in D1) | nothing | as B | as B | **account key, then offline guessing of the master password** | Worker secret; the account key reaches Cloudflare (breaks the DESIGN §4 anti-goal); per-code attempt limits |
| **D.** Approve from a signed-in device (the phone scans a QR code; the Worker relays only ciphertext) | nothing | nothing | nothing | nothing | nothing | camera permission + a QR library on the phone, a QR on the extension, 1 relay route; no help when no signed-in device is left; not email |
| **E.** Drop the account key and check an email code at the Worker | **offline guessing** | **whole vault** | nothing | whole vault | offline guessing | header migration; reverses the 2026-11-05 decision |
| **G.** Mail yourself the account key from the phone's share sheet (no server change) | nothing | nothing | as B | as B | same as today | one button; can't be revoked (no account-key rotation exists) |

Excluded: **passkey/WebAuthn PRF**. Passkeys are a stated non-goal (§4). On Android it means Credential Manager through Google Play services, which clashes with the FOSS rule (§5). Browser PRF support for the extension is uneven (a guess, not checked). **A blinded server oracle (OPRF)** gives the same trust result as C with far more cryptography, so it fails the "no home-made crypto" anti-goal for no gain.

How the sign-in options compare:
- B, B0, C and G are **the same** for (a)-(d). In each one, the inbox becomes the second factor in place of the account key. They differ on (e), on revocation, and on whether each sign-in needs the inbox right now.
- B over G: the owner can **revoke** it (turning email recovery off or making a new recovery key deletes the blob, so old emails stop working). Each sign-in is **visible** (an approval mail, plus a warning in the app on signed-in devices). An old copy of the email, without the live inbox, isn't enough. G costs almost nothing, but an emailed account key is good forever.
- Only C gives the "fresh code each time" that the owner probably pictures, and the price is (e).

## 3. Recommendation: B (account-key-only sign-in blob, same code as email recovery, approval link)

How it works:
1. **Enrolment.** When email recovery is turned on, the client also seals `accountKey` (20 bytes only) under `HKDF(code, "strongroom/v1/signin")` with that label as AAD, using the **same** code. The existing `PUT /v1/account` escrow body gets an optional `signinBlob`. The one email the owner already gets now says the code is for both recovery and signing in, and that they should keep the email.
2. **Sign-in on a new device.** The owner picks "Use email instead of the account key". The device makes a random claim and sends `POST /v1/signin/request {claimHash}`. The Worker mails "Approve signing in on a new device" with a link (a GET form that changes nothing, then a POST, as the lost-access links do). After approval, `POST /v1/signin/release {claim}` returns the sign-in blob for 15 minutes. The owner pastes the code from the original email and types the master password. The client opens the blob, gets the account key, and runs the existing `signInWithPassword`, which is unchanged. From there it continues exactly as a typed account key does (the phone stores the key in the Keystore through `storeAll`; the extension seals it in `device-vault.ts`).
3. **Visibility.** `GET /v1/signin/status` (any bearer, including the read token, like `lost/status`) lets signed-in devices show "A device asked to sign in with your email at <time>. If that wasn't you, turn email recovery off." It is shown in the app only, matching the owner's lost-access decision. `POST /v1/signin/cancel` (bearer) ends an approved request that hasn't been used.
4. **No change** to the vault format, the header flag, the token derivation or `signInWithPassword`. Old clients keep working with the typed key. The new routes are additive.

Why B: it is the safest shape that still fits "email instead of the account key". The Worker never holds the account key. The only exception is the one already accepted: at enrolment the Worker sees the code and blobs in the same request (DESIGN §4, ruling of 2026-11-10). B also keeps the 24-hour wait in front of the recovery key, can be revoked, and makes each use visible.

Residual risks, stated plainly:
- **Inbox + master password opens the vault at once, with no cancel window** (today: 24 hours and cancellable). The approval link gives no protection here, because the attacker approves their own request. Real-time phishing that asks for "the code from your email" is exactly as effective as asking for the account key today.
- **Inbox alone gives away the account key at once, and for good.** There is no account-key rotation anywhere in the code (searched both clients and core). From then on, a later D1 leak can be guessed offline, and the attacker can guess online right away (see item 4 at the top). Today an inbox-only attacker needs the 24-hour wait to reach the same point.
- **Email sign-in only exists while email recovery is on**, because they share one code. Making a new recovery key turns both off (this is how `index.ts:118-120` already behaves, and the phone design's decision 9 already warns about it).
- **The code email can be stale.** The Worker mails before it writes, so an enrolment refused with 409 leaves the owner with an emailed code that matches nothing (`index.ts:105-121`). Now that the owner is told to keep that email, the newest one must be clearly the one that counts.
- The UX is not lighter on typing: the owner pastes a 32-character code and clicks a link.

Where the owner's choice is worse than it sounds: if "a code emailed at sign-in" means a fresh short code each time, that is option C. It undoes what the account key protects against for a Cloudflare-side compromise (offline guessing of the master password), and it breaks the §4 anti-goal. If the real wish is "less typing when I already have the phone with me", option D is better than any email option on every attacker case. I suggest it as a later addition, not a replacement.

## 4. Decisions only the owner can make

1. **Do you accept that inbox + master password opens the vault at once?** Or should email sign-in wait too, for example 1 hour or 24 hours, cancellable from a signed-in device? *Default: no wait, because without a system notification a short wait is rarely seen. Approval link plus in-app warning.*
2. **Static code (B) or a fresh code every sign-in (C)?** C means the Worker holds the account key. *Default: B.*
3. **One code for recovery and sign-in, or a separate sign-in code?** *Default: one code and one email. Sign-in then requires email recovery to be on, and turning recovery on needs a re-enrolment (which rotates the recovery key) to add the sign-in blob.*
4. **Fix the parallel online-guessing gap (item 4 at the top) before shipping any email option?** *Default: yes. A real global limit (a Workers rate-limiting binding or a "next try at" row in D1) on refused tokens, plus one mail to the owner after 20 failures in a row. This keeps the existing "no hard lockout" rule. The limiting mechanism is a guess at what fits; it needs a spike.*
5. **Keep the approval link (B), or a public blob (B0)?** *Default: B. It needs the live inbox and makes each sign-in visible.*
6. **Keep showing the account key at sync setup?** *Default: yes. It is the only way back if the inbox is lost, and a recovery-key reset on a new device needs it (`format.ts:168`).*
7. **Add "new account key" (rotation) later?** *Default: noted, not in this scope.*
8. **Put the request's country (Cloudflare's `CF-IPCountry`) in the approval mail?** *Default: yes. It helps tell your own request from someone else's, and nothing is stored.*

## 5. Task outline (after email recovery is merged)

Before any task starts, the wire contract is fixed here. The changes below are additive.
- `PUT /v1/account` escrow: `{ email, blob, code, signinBlob? }`. `signinBlob` is base64 and accepted only together with `blob`.
- `POST /v1/signin/request { claimHash }` → `{ ok: true }` always (same as `lost/request`).
- `GET|POST /v1/signin/approve` (mailed token).
- `POST /v1/signin/release { claim }` → `{ state: 'ready', blob } | { state: 'waiting' }`.
- `GET /v1/signin/status` (bearer: login, recovery, read) → `{ pending: { requestedAt, approved } | null }`.
- `POST /v1/signin/cancel` (bearer).
- D1: `escrow.signin_blob` (nullable); `signin_request` **one row per claim** (claim hash, confirm hash, requested at, approved until, cancelled), at most 5 live rows, and at most 5 approval mails an hour. One shared row would let a stranger hold the slot, as `lost_request` can today (`db.ts:118-131`).

| # | Task | Touches | Depends on |
|---|---|---|---|
| T1 | Core: `sealSignin` / `openSignin` (open returns null unless 20 bytes), protocol types, transport calls | `packages/strongroom-core/src/escrow.ts`, `sync/protocol.ts`, `sync/transport.ts`, `index.ts`, tests + `package.json` test list | — |
| T2 | Vectors: a `signin` section computed by `apps/strongroom/tools/vectors/escrow_vectors.py`, not by either client | `vault-vectors.json` (**shared; T2 only**), the `.py` | — |
| T3 | Worker: migration `0003`, routes, mail text, per-claim table, the global limit from Q4, tests | `tools/vault-api/src/{index.ts,db.ts,lost-access.ts or new signin.ts,auth.ts}`, `migrations/0003_*.sql`, `__tests__` | T1's `protocol.ts` |
| T4 | Kotlin: `Escrow.kt` sign-in seal/open, wire additions, `SyncSession.signInByEmail` (request / check / open, `@Synchronized`, server state first), `enrolEscrow` adds the sign-in blob, JVM tests on the T2 vectors | `core/Escrow.kt`, `SyncSession.kt`, `SyncClient.kt` and its wire/transport files, tests | T2, contract |
| T5 | Phone RN: "Use email instead" on the Sync sign-in form, in-app warning, module contract + adapter, copy | `apps/strongroom/src/{SyncScreen.tsx,sync-flow.ts}`, `modules/strongroom-vault/src/index.ts`, the module's Kotlin entry | T4 |
| T6 | Extension: `signInEmail` request (request / check / open), enrolment adds the sign-in blob, popup UI, warning | `apps/strongroom-extension/src/{service.ts,popup.ts,sync-copy.ts}`, tests | T1 |
| T7 | Docs: DESIGN §4 (new residual risk), §10 "Account key" + email paragraphs, §11 cross-reference; a handoff file | `docs/strongroom/DESIGN.md` (**T7 only**), `docs/handoffs/` | T3-T6 |
| T8 | Security review of the diff (`security-engineer`), then the gates: `pnpm test`, `pnpm typecheck`, `:strongroom-vault:testDebugUnitTest :app:assembleDebug` | read-only | T3-T6 |

Can run in parallel: T1 ∥ T2. Then T3 ∥ T4 ∥ T6, each in its own tree. Must run in order: T1 → T3 (types), T2 → T4, T4 → T5, everything → T7 → T8. Only T2 writes `vault-vectors.json` and only T7 writes `DESIGN.md`. Both clients go through the in-flight escrow enrolment code (`SyncSession.enrolEscrow`, extension `emailRecoveryEnrol`), so this can't start until that work has merged. No new dependencies.

## 6. Risks and the tests that pin them

| Risk | Test |
|---|---|
| The sign-in blob carries the recovery key | Core/Kotlin: `openSignin` returns null for a 40-byte plaintext; a recovery escrow blob doesn't open under the sign-in label, and the reverse (domain separation), in both directions and on both clients |
| The two clients disagree on bytes | TS and Kotlin both check the T2 `signin` vectors (the TS check is required this time, not optional) |
| The blob is served without approval, or approval is replayed | Worker: release gives `waiting` before approval, after 15 min, for a wrong claim, after cancel and after the escrow is deleted; a second approve doesn't extend the window; the approval GET changes nothing |
| A stranger holds the request slot or floods the inbox | Worker: requests from different claims don't replace each other; at most 5 live; the mail cap holds; a request with no escrow behaves exactly like one with escrow (`{ok:true}`) |
| Parallel online guessing | Worker: N concurrent wrong tokens are refused without being checked once the limit is reached; a good token still passes; the owner mail goes out once |
| The new public routes touch the auth counter | Worker: request, approve and release never change `auth_state` |
| A new recovery key or "off" leaves a working sign-in blob | Worker: a PUT with a new `recoveryHash` and `DELETE /v1/escrow` both null `signin_blob` and end live requests |
| A server strips the header flag, or returns a blob sealed under another code | Clients: the opened key goes through the unchanged `signInWithPassword`, which refuses an unflagged header; a blob that doesn't open is shown as "That code isn't right", never a crash |
| The emailed key differs from the one already stored | Extension `KEY_DIFFERENT` path and the phone equivalent: refuse, never overwrite |
| A double tap or stale screen overwrites a live claim | Phone `@Synchronized` + checking server state first; extension as `lostAccessRequest` (`service.ts:470-484`) |
| Sign-in blocks on a slow Worker | Short timeouts; "couldn't check" instead of an error screen, as phone decision 5 |
| The code email is stale after a refused enrolment | Worker: on 409 the mail went out but nothing was written. Either mail after the write, or the mail text names its date and says the newest one counts. Test whichever the owner picks |

## What surprised me, or contradicts the docs

- `escrow.ts:4` calls the email code "128-bit". It is 20 bytes, so 160 bits (checked with the probe).
- DESIGN §10 says the no-token email routes are "reachable only by someone who holds the sealed blob or opens the mailed link". `POST /v1/lost/request` is open to anyone (it only mails the owner), and one shared `lost_request` row lets a stranger keep re-claiming the slot every hour (`db.ts:118-131`, `lost-access.ts:26-38`). That costs no secrets, but it can block the owner's own request and mislead them.
- The backoff gap in item 4 at the top. DESIGN §10 says "back off exponentially", and the code delays each refused request but doesn't limit how many run at once.
- `requestLostAccess` returns `ok` when the mail fails and when no escrow exists (`lost-access.ts:28-37`). The point is to be indistinguishable, but it means a device can never tell the owner "the email didn't send".
