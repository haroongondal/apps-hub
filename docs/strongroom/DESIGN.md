# Strongroom: design

Working name **Strongroom**. A personal password manager, written entirely as the
owner's own code, that replaces Google Password Manager. Status: approved by the
owner on 2026-10-30.

Mockups from the design session: `.superpowers/brainstorm/6147-1793289451/content/android-flows.html`
(fill, save, import, vault list, entry, recovery key).

## 1. Intent and why

The owner wants their passwords out of Google and out of every other company's
hands. They gave four reasons and hold all of them:

1. **A company could read them**, whatever it says about encryption.
2. **A breach could leak them.**
3. **They could lose access**: a locked, banned or closed account takes every password with it.
4. **They want to own it**: their data, their code, their rules.

Reason 4 is decisive. Self-hosting an existing open-source manager (Vaultwarden plus
Bitwarden apps, or KeePass apps) was offered and **declined**: every part is to be
the owner's own code. Don't propose an existing app as a substitute. Audited
libraries for the crypto primitives are fine and expected (§6). Writing our own
cipher or KDF is not.

## 2. What it does

- Stores **logins** (name, website and/or app, username, password, note), **payment
  cards** and **secure notes** in an encrypted vault.
- **Fills** logins into Android apps and websites. Fills cards into card fields
  that are labelled as card fields.
- **Offers to save** a login when the owner signs up or logs in with a password
  it doesn't know, or **offers to update** one that changed.
- **Imports** everything from a Google Password Manager export, once.
- **Syncs** through the owner's own Cloudflare account, which only ever holds
  ciphertext. Every device keeps a full local copy, so losing the server costs
  sync, not passwords.
- **Recovery key**: shown once at setup. It is the only way back in if the master
  password is forgotten.

## 3. Devices and order of work

The owner uses an Android phone (apps and Chrome), a Mac (Chrome, plus Safari or
Firefox) and an iPhone. Android ships first and must work end to end before
anything else is built.

| Phase | Scope | Notes |
|---|---|---|
| 1 | **Android, local vault**: setup, unlock, logins/cards/notes, search, Google import, autofill fill + save in apps and in Chrome on the phone | **Testing only.** Google stays the phone's everyday autofill service until Phase 2 runs, because until then the phone would be the only copy of every new password (owner's decision). The owner switches to Strongroom to test, then back. Don't delete anything from Google yet. |
| 2 | **Cloudflare sync**: Worker + storage, Android sync client, "sign in on a new device with the master password" | Gives the owner an off-phone copy. **Daily use starts here**: Strongroom becomes the phone's autofill service, and Google's copies can be deleted once sync is confirmed. |
| 3 | **Chrome extension on the Mac and Windows** (Manifest V3): fill + save on websites, sync | First TypeScript implementation of the vault format. Same extension on both. No desktop app: Chrome lets only extensions fill its pages. |
| 4 | **Firefox** (same WebExtension code base) | Release Firefox only runs Mozilla-signed add-ons. Use self-distributed ("unlisted") signing, which sends Mozilla the code but never any passwords. |
| Later | **iPhone app + Safari extension** | Blocked: the owner won't buy the Apple developer account yet ($99/year; free builds expire every 7 days). Keep the vault format and sync API platform-neutral so these can be added without changes. |

Each phase gets its own plan. This document covers all of them at design level.
Phase 1 is described in the most detail.

## 4. Goals, non-goals, anti-goals

**Goals**
- Nothing but ciphertext ever leaves a device. Cloudflare sees record IDs, sizes
  and timestamps, never names, sites, usernames or passwords.
- Filling a saved login takes no more effort than Google's manager: tap the field,
  tap the suggestion, touch the fingerprint sensor.
- The owner can always get their passwords back: local copy on every device, the
  server copy, and the recovery key for a forgotten master password.

**Non-goals for now** (each one is a deliberate cut)
- 2FA / authenticator codes (owner chose not to include them).
- Passkeys, and the Android 14+ Credential Manager provider API
  (`CredentialProviderService`). Phase 1 uses the autofill framework only.
  Credential Manager is the likely next addition after Phase 4.
- Password generator, password history, sharing with other people,
  breach checking. *(My calls. The generator is small and the obvious first
  extra.)* CSV export came later, on the owner's request (§8).
- Saving cards from forms. Cards are added by hand and only filled. *(My call.)*
- Filling apps that block autofill by abusing the accessibility service (the
  Deputy technique). It's too easy to get wrong for passwords.
- Multiple users, or accounts for anyone but the owner.

**Anti-goals** (failure even if everything "works")
- Any path where a password, or the key that unlocks them, reaches Cloudflare or
  any other third party in readable form. One narrow, known exception: enrolling
  email recovery sends the Worker the emailed code and the sealed blob in the
  same `PUT /v1/account` request, so for that one request the Worker could in
  principle open the blob itself. *(Security review's point, acknowledged, not fixed.)*
  **Owner ruling, 2026-11-10:** accepted as-is for now — this is still the
  development phase and no real vault data exists in the extension yet. Revisit
  (the `mailto:`-draft alternative is the documented option) before this is used
  with a real vault or released to anyone else.
- The lock-free autofill device key is the full sign-in token, not a read-only
  one, so someone with brief access to this browser profile could take over the
  synced account (delete the email-recovery escrow, cancel a pending lost-access
  request, rotate the password/recovery key) — not just read the vault, which is
  the risk the design otherwise accepts. *(Security review's point, HIGH.)*
  **Owner ruling, 2026-11-10:** accepted as-is for now, same reasoning as above
  — development phase, no real vault data at stake yet. Revisit (the read-only
  device token, matching how the Android app already does it, is the documented
  option) before this is used with a real vault or released to anyone else.
- A password filled into the wrong app or a lookalike site.
- Losing the vault: a sync bug, a bad merge or a failed import that destroys
  entries.
- Home-made cryptography: our own cipher, our own KDF, or "clever" key handling
  outside the scheme in §6.
- Any telemetry or crash reporting. Same zero-telemetry rule as the rest of the repo.

## 5. Fixed constraints (from the repo and the owner)

- Lives in this monorepo: `apps/strongroom` (Expo SDK 54, RN 0.81.5, TS 5.9),
  Android-only like Deputy, so no `ios/` folder yet.
- Package `com.haroon.strongroom`, signed with the shared release key, released
  with `pnpm release strongroom` (add it to `tools/release/src/apps.ts`), and
  **installed only through the private Store**, never `adb install`.
- UI from `@apps-hub/ui` only. Add a `strongroom` brand to
  `packages/ui/src/tokens.ts` (provisional hue/accent until the launcher icon
  exists, as Deputy did), then `pnpm --filter @apps-hub/ui build:css`.
- Native code in an Expo local module, `apps/strongroom/modules/strongroom-vault`
  (Kotlin), behind a thin TS adapter, the same way as `deputy-agent`.
- **Kotlin owns the vault.** The autofill service runs with no React Native
  runtime, so crypto, storage, matching, autofill, import and sync all live in
  Kotlin. RN only renders screens. Kotlin hands JS only what a screen shows: list
  rows carry name, site/app and username, never passwords. A password crosses to
  JS only when the owner taps Show or edits the entry. Copy happens natively.
- `minSdk 33` (Android 13), matching Deputy. *(My call.)*
- Tests: Kotlin JVM unit tests (`:strongroom-vault:testDebugUnitTest`) for all
  vault logic; `node --test` for any TS logic. Add the Gradle gate to the
  "Verification Commands" in `AGENTS.md`.
- Dependencies must be free and open source with no tracking (§6 lists the
  expected ones). Use the `upgrading-dependencies` skill when adding them.
- Cloudflare: use the `cf` CLI (as `tools/store-api` does) on the **personal**
  account. Confirm the account with the owner before the first deploy.

## 6. Vault format and keys (the part both platforms must agree on byte for byte)

Android (Kotlin) implements this in Phase 1 and the extension (TypeScript) in
Phase 3. Both must pass the **same shared test-vector file**: fixed inputs and
expected outputs for every derivation, plus fixed sealed blobs (both wraps and
one record of each type) that must decrypt to known plaintexts. Main code never
takes a nonce from the caller. The fixed-nonce encryption that made those blobs
lives in test code only. *(Reviewer's point, adopted.)* Write the file in
Phase 1. Phase 3's TS tests read the same file.

**Primitives**
- KDF: **Argon2id**, starting params m = 64 MiB, t = 3, p = 1, 16-byte random salt.
  The params live in the vault header, so they can be raised later without a
  format change. Tune them so unlocking with the master password takes about 1–2 s
  on the phone.
- A device refuses KDF params below the floor (m = 32 MiB, t = 2, p = 1) or above
  the ceiling (m = 1 GiB, t = 16, p = 4) **before deriving anything**, and never accepts a header
  whose params are lower than the one it holds. Otherwise a tampered header, or
  the server in Phase 2, could make the password cheap to guess. *(Reviewer's
  point, adopted.)*
- Key splitting: **HKDF-SHA-256** with distinct `info` labels
  (`strongroom/v1/wrap`, `strongroom/v1/login`, …).
- Encryption: **AES-256-GCM** with a random 96-bit nonce per encryption. Both
  Android (`javax.crypto`) and browsers (WebCrypto) provide it natively, so the
  cipher needs no dependency.
- Libraries: Android uses BouncyCastle's lightweight Argon2 API
  (`org.bouncycastle:bcprov-jdk18on`, MIT). Use its classes directly; don't
  register it as a JCA provider. The extension uses `@noble/hashes` (MIT,
  audited) for Argon2id and HKDF, or WebCrypto where it can.

**Keys**
```
master password ──Argon2id(salt, params)──▶ masterKey
masterKey ──HKDF "wrap"──▶ wrapKey      ──AES-GCM──▶ passwordWrap(vaultKey)
masterKey ──HKDF "login"─▶ loginToken   (sync auth, Phase 2)

recovery key (20 random bytes, shown as 8 groups of 4 base32 chars)
recoveryKey ──HKDF "wrap"──▶ AES-GCM ──▶ recoveryWrap(vaultKey)     (no Argon2: it's 160 random bits)
recoveryKey ──HKDF "login"─▶ recoveryLoginToken

vaultKey = 32 random bytes, generated once. Changes only through a re-key (§10).
           Encrypts every record. Changing the master password re-wraps it and nothing else.
```

**Records.** One record per entry: `{ id: random UUID, ciphertext }`. The
ciphertext is AES-GCM under the vaultKey of a JSON entry (`type: login | card |
note`, fields, `updatedAt`, …), with **AAD = record id + format version**, so
neither the server nor a bug can move one record's ciphertext onto another id.
Deletions are tombstones: the same record id, with a ciphertext that says
"deleted".

**Header.** Format version, KDF params, salt, `passwordWrap`, `recoveryWrap`, and,
once sync is on, an optional `"accountKey": true` as the last field (§10). A header
without the flag reads and serialises exactly as in Phase 1. No secrets in readable form.

**On the phone**
- Storage: the platform SQLite (`android.database.sqlite`, no new dependency) in
  app-private storage. It holds the header plus records exactly as above, so the
  phone's database and the server hold the same bytes.
- **Match index** (owner's decision, so a locked vault can still show the matching
  login, as in the mockup): for each login, its name, websites, apps and username
  are also stored encrypted to an Android Keystore AES key that does **not** need
  the fingerprint. The key is created with `setUnlockedDeviceRequired(true)`, so
  it opens only while the phone itself is unlocked. *(Reviewer's point, adopted.)*
  While locked, the autofill service reads only this index, never passwords. The
  index holds no cards. Accepted cost: code running as the app can see the login
  names, which sites and apps the owner uses, and the usernames, but not the
  passwords. The index is rebuilt from the vault on every unlock, so it can't drift.
- `android:allowBackup="false"`: the vault leaves the phone only through our own sync.
- Phase 1 release builds don't hold the `INTERNET` permission. Debug builds keep
  it for the JS dev server, and Phase 2 adds it back for sync. *(Reviewer's point,
  adopted.)*
- Unlocked state: the vaultKey lives **in memory only**. Locking wipes it.
- Fingerprint: after the first master-password unlock, the vaultKey is also wrapped
  by an Android Keystore AES key created with `setUserAuthenticationRequired(true)`
  and `setInvalidatedByBiometricEnrollment(true)`, and unwrapped through
  `BiometricPrompt` (`androidx.biometric`, Apache-2.0). If a new fingerprint is
  enrolled, the master password is required again. Turning fingerprint on asks for
  the master password. *(Reviewer's point, adopted.)*
- Auto-lock 5 minutes after last use (setting: 1 / 5 / 15 min), on "Lock now",
  and on reboot. After a reboot the master password is required, not the fingerprint.
  *(My calls.)*
- The auto-lock clock is `elapsedRealtime`, which keeps counting in deep sleep.
  The check runs on every vault access (opening the app, each fill or save
  request, each call from a screen) and locks before serving anything. Only
  Strongroom's own screens and unlocks count as use, so autofill requests from
  other apps never keep the vault open. *(Reviewer's point, adopted.)*
- `FLAG_SECURE` on every window of the app, so the vault never appears in
  screenshots or the recents screen. Both activities (the app and the autofill
  unlock screen) also hide other apps' overlay windows (`setHideOverlayWindows`)
  and ignore taps on Fill and Yes buttons while something covers them
  (`filterTouchesWhenObscured`). *(Reviewer's point, adopted.)*

**Master password and recovery key rules**
- Master password: at least 12 characters, no composition rules. *(My call.)* It
  also can't be on a bundled list of the 10,000 most common passwords, a single
  repeated character, or a straight sequence such as `abcdefghijkl`: "That
  password is too common. Pick something only you would think of." *(Reviewer's
  point, adopted.)*
- Recovery key: shown once at setup, with "write it down or print it; anyone with
  it can open your vault". Setup can't finish until the owner types back one group
  of it, to prove it was saved. *(My call.)* Settings can generate a new recovery
  key, which replaces `recoveryWrap` and the old key stops working. Generating one
  asks for the master password. *(Reviewer's point, adopted.)*
- Forgot the master password: enter the recovery key, then set a new master password.

## 7. Android autofill (Phase 1)

An `AutofillService` in the `strongroom-vault` module. Setup ends by sending the
owner to the system setting
(`Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE`) to choose Strongroom.

**Fill**
- Parse the `AssistStructure` for username, password and card fields: autofill
  hints first, then input types, then (for browsers) HTML attributes from
  `ViewNode.getHtmlInfo()`.
- Identify the requester: apps by **package name + signing-certificate SHA-256**,
  web pages by `webDomain` (and `webScheme`) in browsers.
- Offer matching logins as **inline suggestions** above the keyboard (API 30+),
  with the dropdown as the fallback. If the vault is locked, the suggestions come
  from the match index (§6) and each one carries an authentication intent: it
  opens the unlock screen (fingerprint, or master password), then completes the fill.
- The unlock screen trusts only what Strongroom put in the authentication intent
  itself (mode, entry, requester and target fields, taken from the structure the
  service received). It never reads the `AssistStructure` or client state that
  Android attaches, because the requesting app can change those. Intents are
  immutable and unique per suggestion. Before returning a login it checks the
  match again on the decrypted entry, and it returns exactly one dataset.
  *(Reviewer's point, adopted.)*
- Card suggestions always carry the authentication intent, so every card fill asks
  for the fingerprint, even when the vault is unlocked. While locked there is one
  generic "Unlock to fill a card" item, because the match index holds no cards.
  *(Reviewer's point, adopted.)*
- Cards aren't tied to an app or site, so nothing checks who asks for one. Instead
  the unlock screen and the fingerprint prompt say who the fill is for, as the link
  prompt below does: "This fill is for **package** (on **domain**)." or the site's
  registrable domain, plus "This app was installed from a file, not from an app
  store." when it was. Every unlock screen shows it, logins too, because a locked
  vault can't tell a card from a login until it opens. *(Security review, adopted.)*
- Always add an **"Other logins"** item that opens a picker (after unlocking), for
  logins that don't match automatically. Picking one for an app or site it wasn't
  saved for offers **Fill once**, the default, which stores nothing, and a
  separate **Always use here**, which stores the link. The prompt names an app by
  its package name and says if it was installed from a file, or shows a site's
  registrable domain in bold. It never shows an app label or page title, which
  the requester chooses. If the login already holds the same package with a
  different certificate, Strongroom refuses: "This app has the same name as the
  saved one but a different signature. It may be fake. Strongroom won't fill it."
  *(Reviewer's point, adopted.)*

**Matching rules** (security-critical; unit-test every rule)
- Websites match on **registrable domain** (eTLD+1): `login.example.com` matches
  `example.com`, `example.com.evil.io` does not. The public suffix list is
  Mozilla's current `public_suffix_list.dat` (MPL-2.0), vendored into the module
  with its source URL and date. Our own code applies the standard algorithm
  (normal, wildcard and exception rules) and is tested against the list project's
  `test_psl.txt`. OkHttp's copy in React Native dates from 2021, so it isn't used.
  *(Reviewer's point, adopted.)*
- Matching fails closed. A host with no registrable domain (an IP address, a
  single-label name) matches only exactly the same host, port included, and its
  suggestions show the host, as do those for `.local` hosts. A page that doesn't
  report its scheme counts as http. *(Reviewer's point, adopted.)*
- A login saved from an **https** page fills only on https pages.
- Apps match only on **package name AND certificate digest** both equal to the
  saved ones, so a sideloaded lookalike with the same package name gets nothing.
  If the requester's certificate can't be read, or an imported one can't be
  decoded, there is no app identity and nothing matches. *(Reviewer's point,
  adopted.)*
- A `webDomain` counts only when the requesting app is a **known browser**
  (allowlist of package + certificate: Chrome, Firefox, and so on). In any other
  app, matching uses that app's own identity, even if it reports a web domain.
  Otherwise an app could load the real bank page in its own WebView and read the
  filled password. *(Reviewer's point, adopted.)*
- When such an app does report a web domain, a link or save made there is tied
  to the app **and** that registrable domain, and fills only when both match. So a
  login linked on one page of an app doesn't fill on another site the app shows,
  and a save there never updates another site's login. A link to an allowlisted
  browser itself is never stored: a Chrome screen with no web domain gets nothing.
  No setting trusts another browser in Phase 1, so the owner's Mi Browser gets
  app-scoped, domain-bound links only. *(Reviewer's point, adopted.)*
- In a browser, fill only when every target field reports the requester's web
  domain, so a cross-origin frame never receives the login. Check how Chrome
  reports frames on the device.
- No app-to-website guessing (Digital Asset Links) in Phase 1. The owner links an
  app to a website login once via "Other logins". *(My call.)*

**Save**
- Every fill response carries `SaveInfo` for the detected fields, so Android
  shows its "Save to Strongroom?" sheet after a sign-up or login.
- `onSaveRequest`: if a login exists for this app/site and username, update its
  password (Android shows "Update"). Otherwise create a new entry named after the
  app label or the site.
- If the vault is locked at save time, use the match index to decide Save or
  Update straight away. Hold the new password encrypted to a Keystore key and
  write it into the vault at the next unlock. Never drop it, and never keep it in
  plaintext. If it can't be sealed, the save request fails with a message rather
  than looking saved. Pending saves that can't be opened at unlock are reported:
  "N saved passwords couldn't be recovered." *(Reviewer's point, adopted.)*

**Strongroom's own screens** are never autofill targets. The app's screens and
the unlock screen exclude themselves from autofill, the service ignores requests
from Strongroom's own package, and password fields turn off autocorrect and
suggestions. Otherwise Google, or Strongroom itself, would offer to save the
master password, and the keyboard could learn it. *(Reviewer's point, adopted.)*

**Chrome on Android** passes web forms to third-party autofill services only when
the owner switches on Chrome's setting to use another autofill service (Chrome
131 and later; check the exact label on the phone). Setup shows that step.
Firefox for Android uses the autofill framework without any setting.

**Accessibility**: every Strongroom window, the unlock screen included, is marked
sensitive to accessibility services on its root view
(`View.setAccessibilityDataSensitive`, API 34+), so an accessibility app, such as
the owner's own Deputy, can't read a password and pass it to its cloud model.
`importantForAccessibility` alone isn't enough, because services that ask for
not-important views still see them. It stays only as the API 33 fallback on a
shown password. *(Reviewer's point, adopted.)*

**Clipboard (fallback only)**: copy marks the clip sensitive
(`ClipDescription.EXTRA_IS_SENSITIVE`) with a random token in its extras, stores
the token and time, and clears it after 30 s: a timer while the process lives and
a `JobScheduler` job that survives Android killing it. Since Android 10 an app in
the background can't read the clipboard but may still clear it, so the 30 s clear
can only check that the clip is still Strongroom's while Strongroom has focus;
from the background it clears without looking, which can wipe something the owner
copied after the secret (accepted: better than a password left behind). The job only
has a minimum delay, so Doze or the app standby bucket can run it minutes later and
widen that window well past 30 s. When
Strongroom's window next gains focus, it clears an overdue clip that still carries
its token and nothing else, for the case where the job was killed too (HyperOS
can cancel a swiped app's jobs). *(Security review, adopted.)* Check on the
device that the job clears after a swipe from recents, and whether the phone's
keyboard keeps the clip in its own clipboard history despite the flag.

## 8. Google import (Phase 1)

- The owner exports from Google Password Manager (Settings, then Export passwords)
  and picks the file with the system file picker.
- Expected CSV columns: `name,url,username,password,note`. Android-app entries
  have URLs like `android://<base64 cert hash>@<package.name>/`. Map those to app
  links with no web domain (package + cert digest) and web URLs to website
  matching. A hash that doesn't decode gives no app link; the login is still
  imported, unlinked. **Check both
  formats against a real export before writing the parser.** For the test
  fixture, write a small redaction script that the owner runs on their own Mac.
  It replaces usernames and passwords but keeps the structure, so the builder
  never sees real credentials.
- RFC 4180 CSV: quoted fields, commas, quotes and newlines inside fields.
- Merge exact duplicates (same site/app, username and password). Keep entries
  that share a site and username but differ in password as separate entries,
  flagged for review. Show "N logins found, M duplicates merged" before
  committing.
- Import is all-or-nothing in one database transaction.
- After import, tell the owner to delete the exported file, because it's
  plaintext. The app can't delete a file it didn't create, so it says this
  plainly instead.

**Added 2026-11-06, on the owner's request (Android app only, not the extension):**

- **Export all** (master password first) writes a plaintext CSV through the system
  save dialog. Google's five columns come first, one row per site or app link, then
  `type,holder,number,exp_month,exp_year,cvc,app_domain` for cards, notes and an app
  link's web domain. The phone's import reads them all back; a login with several
  links comes back as one login per link, as with Google's own export. The
  extension's import skips card and note rows. Cells aren't escaped for
  spreadsheets, because escaping would change passwords that start with `=`.
- **Imported files** lists each import, newest first. An import is the set of entries
  sharing the one stamp `putMany` gave them. An edit restamps an entry, so deleting an
  import removes only the entries still exactly as imported. Its tombstones carry the
  import's stamp, so an edit on another device that isn't pulled yet still wins the
  sync. File names live only in
  this phone's prefs (stamp → name, count). Imports made before this log existed are
  found by their shared stamp and labelled by date.
- **Delete all passwords** (master password first) syncs first when sync is on (best
  effort), then tombstones every entry, so the deletes reach the other devices too.

## 9. App screens (Phase 1)

Built from `@apps-hub/ui`. Rough layout in the mockups.

- **Setup**: create master password → recovery key (type one group back) →
  turn on fingerprint → choose Strongroom as the autofill service → Chrome
  setting → optional Google import.
- **Unlock**: fingerprint, or master password; "Forgot master password" → recovery key.
  After unlocking, a notice reports any pending saves that couldn't be recovered (§7).
- **Vault**: search across everything; Logins / Cards / Notes tabs; rows show
  name, site/app and username. Footer shows sync state from Phase 2 on.
- **Entry**: view with Show / Copy; edit; delete (with confirmation). Logins show
  their linked websites and apps.
- **Add**: login, card or note.
- **Import from Google.**
- **Settings**: auto-lock time, fingerprint on/off, change master password, new
  recovery key, lock now. Turning fingerprint on and generating a new recovery key
  both ask for the master password (§6). Sync account and status come in Phase 2.

Copy follows the repo rules: sentence case, active voice, errors say what
happened and how to fix it. Password and recovery-key fields are hidden while
typed and turn off autocorrect and autocomplete (§7, own screens).

## 10. Sync (Phase 2)

**Server**: a new Worker, `tools/vault-api` (pattern of `tools/store-api`:
`cf` CLI, `cloudflare.config.ts`, secrets in a git-ignored `.dev.vars`), with
**D1** for storage. *(My call. Small tables, transactions, nothing to manage.)*

- `account` row: header (§6) plus `SHA-256(loginToken)`, `SHA-256(recoveryLoginToken)`
  and `SHA-256(readToken)`.
- `records` table: `id`, `rev` (server-assigned, increasing), `ciphertext`, `updated_at`.
- `GET /v1/prelogin` returns KDF params + salt (public, so a new device can derive
  keys). The device checks them against §6's floor and ceiling before deriving,
  so the server can't turn the login token into a cheap password check.
  *(Reviewer's point, adopted.)*
- Every other call except the email-recovery routes below takes
  `Authorization: Bearer <loginToken | recoveryLoginToken>`. The Worker hashes
  it and compares in constant time, the same way as the store-api `safeEqual`.
  No sessions.
- Email recovery (security hardening, below) adds two D1 tables — `escrow`
  (one row: the enrolled email and the sealed recovery+account-key blob) and
  `lost_request` (one row: the claim/confirm hashes and the 24-hour
  `release_at`) — and `PUT /v1/account` can carry an `escrow` field that
  rotates the recovery key and sends the owner a mail with the confirmation
  code. `POST /v1/lost/request`, `POST /v1/lost/release`, and the mailed links'
  `GET` (renders a form, no state change) and `POST` confirm/cancel routes take
  no bearer token: they are reachable only by someone who holds the sealed blob
  or opens the mailed link.
- `readToken` (HKDF `strongroom/v1/read` from the masterKey) can only call
  `GET /v1/records`. It is the token the phone keeps for background downloads.
  *(Reviewer's point, adopted.)*
- `GET /v1/records?since=<rev>` returns changes. `POST /v1/records` takes a
  batch of upserts in one transaction and returns their new revs. Each upsert
  carries the rev it was based on. A stale one is rejected (409), and the client
  pulls, merges and retries, so two devices never silently overwrite each other.
- `PUT /v1/account` is for a master-password change or a new recovery key:
  new header + new token hashes, applied atomically.
- **Account creation** needs a one-time `SETUP_TOKEN` secret (set at deploy, typed
  once on the phone) and works only while no account exists, so nobody who finds
  the Worker URL can claim it first. It works **once, ever**: creating the account
  writes a "created" marker that nothing deletes, so removing the account row
  doesn't reopen setup. *(Reviewer's point, adopted.)*
- Count failed auth globally and back off exponentially. No hard lockout, which
  anyone could use to lock the owner out. The mechanism (Workers rate-limiting
  binding or a counter in D1) is the builder's choice. *(Reviewer's point, adopted.)*
- The Worker URL is built into the app (and later the extension). Single owner.

**Client merge**: pull since the last rev, then push local changes. Conflicts
are per entry: the later `updatedAt` (inside the ciphertext) wins, and tombstones
win over older edits. A record the client can't decrypt is **kept as is, never
deleted**, and reported. A readable local record always beats a remote one the
client can't decrypt: the remote blob is quarantined and reported, and the client
never uploads over a server record it couldn't decrypt. A new header from the
server (a password changed on another device) is adopted only after the owner's
new password unwraps it to the vaultKey this device already holds, and never with
lower KDF params. *(Reviewer's point, adopted.)*

Sync runs on unlock, after every change, and on a periodic background job. The
phone keeps the read-only `readToken` encrypted to its own Keystore key, which
needs no fingerprint and, unlike the match-index key, has no unlocked-device
requirement. So a background sync can **download** while the vault, or the phone,
is locked. Merging and uploading wait for the next unlock.

**Re-key** (after a suspected compromise): a new vaultKey, every record
re-encrypted, new wraps, then a full upload. *(Reviewer's point, adopted.)* **Not
built in Phase 2**: it is deferred to a later task (Task 9).

**New device**: enter the master password → prelogin → derive keys → download header and records → unlock.

**Account key** (decided 2026-11-05, the owner delegated the call): a second
secret beside the master password, so a D1 leak can't be guessed offline and a
phished master password alone opens nothing. It is 20 random bytes, shown and typed
like the recovery key (8 groups of 4 base32 characters, the same encoder), made
when sync is turned on and typed once on each new device. It is mixed in right
after Argon2id and **before** the HKDF split, so the wrap key and both tokens need
both secrets. Mixing it into the wrap alone would leave `SHA-256(loginToken)` on the
server as a second offline guessing check.
```
mixed = HKDF-SHA-256(ikm = Argon2id output, salt = accountKey, info = "strongroom/v1/account", 32)
mixed ──HKDF "wrap" | "login" | "read"──▶ wrapKey, loginToken, readToken
```
- The recovery key path is unchanged: it is 160 random bits already.
- **Header flag, not a version bump**: a header that needs the key carries
  `"accountKey": true` (§6). Strongroom 0.1.1 can't read a flagged header and fails
  closed as "wrong password". Turning sync on re-wraps `passwordWrap` under a new
  salt with the same KDF params; the vaultKey and the records don't change.
- A device mixes the key in only for a local header that carries the flag. What
  stops a server that strips the flag is that sign-in, recovery through the server
  and header adoption all refuse a server header without it, on both clients.
- Forgetting the master password on a device with a flagged vault: the local reset
  takes the recovery key **and** the account key. The phone uses its Keystore copy;
  if that is gone, the owner types the written-down key (twice, since nothing can
  check it), and the phone keeps it again.
- Where it is kept: the phone in the Android Keystore (same key class as the match
  index, `setUnlockedDeviceRequired(true)`); the extension in `chrome.storage.local`
  (trusted contexts only) beside the header. It is shown again only after the
  master password is re-entered.
- Test vectors: the `accountKey` section of the shared vector file, computed by
  `apps/strongroom/tools/vectors/account_key_vectors.py` (argon2-cffi and its own
  HKDF), not by either client.

**As built in Phase 2** (decisions the plan left open; rulings in the Phase 2 ledger):
- Account update: `ifRev` (the last header revision this device took) is required,
  so a stale update gets 409 instead of overwriting. `recoveryHash` is optional and
  the Worker keeps the stored one when it is left out. On the phone a 409 means
  "sign in again", and a password or recovery-key change made there doesn't reach
  the other devices.
- Turning sync on asks for the setup code, the master password and the recovery
  key, and checks that the recovery key opens this vault. The account key is in the
  Keystore before the flagged header is written. If the server refuses the setup
  outright (wrong setup code, a bad request, an account that isn't this phone's),
  the old header and mode come back; only an unclear failure (offline, a server
  error, a lost reply) leaves setup pending, and a retry shows the same key.
- A local header change (new master password, new recovery key, local reset) is
  written only after its sync bookkeeping: the new tokens are kept apart from the
  ones the server knows, and a pending mark names the new header. The tokens swap
  only after the server took the update. A mark whose header never got written is
  dropped.
- A remote header (password changed elsewhere) is adopted at the next password
  unlock or sign-in, where the password is at hand; background sync only notes it.
- Merge details: an entry over the size limit (90,000 base64 characters) is left
  out of every push, stays local and is reported, and never blocks the others. A
  local entry that doesn't decrypt is kept, never overwritten or pushed, and
  reported. A pull adopts a remote entry only if the local one is unchanged since
  the merge looked at it; otherwise the local edit stays for the next sync and the
  last-seen revision is held back so that entry comes again.
- Pages: both clients ask for 100 records per pull (the Worker allows up to 500).
- Failed sign-ins: one counter in D1. After 5 failures each refused request waits
  2, 4, 8 and 16 s, then 20 s at most, which stays under both clients' 30 s
  timeouts. A good token resets it and is never delayed.
- The phone's background job runs every 15 minutes, without a network constraint
  and not kept across reboots (either would need a new permission); app start
  schedules it again. It downloads with the read token into a staging table
  and never touches the vault; the next unlock merges the staged rows through the
  normal merge, even offline.
- The phone keeps the login token under the Keystore key that opens only while the
  phone is unlocked, so a fingerprint unlock can still upload edits. *(Provisional,
  for Task 8's security review.)*
- The extension's recovery sign-in also sends an account update, held as pending
  (sync waits while it is pending, and a refused token never drops it) until the
  server takes it.

**Accepted limits** (single owner, own account): the server could withhold or
roll back records, or delete them. It can't read or forge them. Every device's
local copy is the defence against loss. One more, on the phone: if a master-password
or recovery-key change is cut short (its write fails, or the app stops) while an
earlier change still waits to go up, sync can drop both, quietly. That phone keeps its
new password or recovery key while the server and the other devices keep the old
ones. Making a new recovery key on that phone ends the difference: it sends the whole
header with tokens and a recovery hash to match. A new master password does too,
unless what was dropped included a new recovery key.

## 11. Browser extensions (Phases 3–4), design level only

**As built (2026-11-04), Chrome only, before sync:** `apps/strongroom-extension` keeps
its own local vault (same format as §6, `packages/strongroom-core` passes the shared
vectors). The Android vault has no export and the release app has no network access, so
the two vaults are separate until sync exists; joining them later means re-sealing one
vault's entries under the other's key. Cut for now: cards and notes in the UI, change
master password, clipboard auto-clear and adjustable auto-lock (fixed 5
minutes). The common-password check came with sync: the same ten entries as the phone,
with a test that keeps the two lists equal. Details and next steps: `docs/handoffs/strongroom-extension.md`.

**Security hardening (2026-11-08 plan, `docs/handoffs/strongroom-extension-security.md`):**
Export for Chrome, lock-free autofill and background sync (a key sealed under a
non-extractable WebCrypto key survives auto-lock and a browser restart; only the
manual Lock button clears it), a sealed account key, and opt-in email recovery
(rotates the recovery key, escrows it with the vault server under an emailed code,
24-hour owner-cancellable wait). Fingerprint is designed but not built, pending the
owner's hardware spike.

**With sync (Phase 2):** the phone creates the account; the extension signs in with
the master password and the account key (§10). If the extension already holds the
account's vault (an earlier sign-in), the sign-in merges and keeps its local edits.
An empty vault is replaced by the account's. A different vault with entries is
replaced only after the extension shows the count and the owner confirms, and only
after every step succeeded; one vault is never re-sealed into the other.

- One WebExtension code base (Manifest V3) for Chrome, then Firefox. TS vault
  logic in a new pure package, `packages/strongroom-core`, Hermes-safe like
  `open-tunnel-core`, so a future iPhone app can reuse it. It passes the shared
  test vectors.
- Content script detects login forms and shows a fill suggestion. On submit it
  offers save/update. Matching follows the same rules as §7.
- The vault key, and with sync the login token, are held only in
  `chrome.storage.session` (memory) while unlocked; locking the popup clears
  both. Since the 2026-11-08 security plan, a second copy of the vault key is
  also sealed under a non-extractable WebCrypto key in `chrome.storage.local`/
  IndexedDB, so autofill and background sync keep working through auto-lock
  and a browser restart; only the Lock button clears that sealed copy too. The
  encrypted vault is cached in `chrome.storage.local`. Same auto-lock times for
  the popup itself.
- Chrome on the Mac and on Windows: the same extension, loaded unpacked in
  developer mode. *(Fine for one owner; no Web Store listing.)* Check on the
  Windows machine whether Chrome warns about or disables developer-mode
  extensions there. If it does, publish the extension as an unlisted Chrome Web
  Store item (one-time developer fee; Google sees the code, never passwords).
- A desktop app (filling ordinary Windows or Mac programs, Windows Hello unlock)
  is out of scope. It would sit beside the extension, not replace it.
- Each extension phase gets its own detailed design before planning.

## 12. Security review gates

This is a password manager written from scratch, so the plan includes, as tasks:
1. A threat-model review of §6, §7 and §10 by the `security-engineer` agent
   **before** Phase 1 code is written. Feed its findings back into this document.
   Done on 2026-10-30: 17 findings (none critical, 5 high). The accepted ones are
   folded into §6–§10 and the Phase 1 plan, marked as the reviewer's points. The
   account-key question in §10 is the owner's to decide.
2. A review of the finished crypto, storage and matching code before Phase 1 is
   called done, and again for the Worker before Phase 2 is called done.
3. On-disk check: after saving a known password and username, neither may
   appear in readable form anywhere in the app's data directory, including the
   match index and any pending save.

## 13. Phase 1 done means

Checked on the owner's phone, installed through the Store, with Strongroom
switched on as the autofill service only for the test (§3):
- Fill: saved login fills in an app and on a site in Chrome; a locked vault shows
  the matching username, then asks for the fingerprint; after a reboot it asks
  for the master password. A card fill asks for the fingerprint even when
  unlocked. "Other logins" fills once by default and stores a link only on
  "Always use here".
- Save: signing up in an app and on a site offers "Save"; changing a password
  offers "Update"; a save while locked is stored after unlock.
- Matching: a lookalike domain, a different-signature app and a non-browser
  app's WebView showing a saved site all get no suggestion, and a
  different-signature app can't be linked. The last three need fixture apps, so
  the JVM matching tests check them instead of the phone.
- Own screens: with Google as the autofill service, nothing offers to save the
  master password during setup or Add, and Deputy's view of Strongroom's
  screens is empty.
- The release APK holds no `INTERNET` permission.
- Import: a real Google export imports with the right counts; app entries fill
  in their apps.
- Recovery: a forgotten master password is reset with the recovery key, and the
  vault stays intact.
- JVM tests cover the vectors, wrong password, tampered ciphertext, CSV edge
  cases, every matching rule, and local add/edit/delete. `pnpm test` and
  `pnpm typecheck` pass.
- The on-disk plaintext check passes.

## 14. Left to the builder

Module and file layout inside `apps/strongroom`, screen components, the exact
SQLite schema, JSON field names inside an entry, Argon2 params after measuring
(within §6's bounds), the test-vector file location, the rate-limit mechanism,
the launcher icon and brand colours.
