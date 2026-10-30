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
- Password generator, password history, sharing with other people, CSV export,
  breach checking. *(My calls. The generator is small and the obvious first
  extra.)*
- Saving cards from forms. Cards are added by hand and only filled. *(My call.)*
- Filling apps that block autofill by abusing the accessibility service (the
  Deputy technique). It's too easy to get wrong for passwords.
- Multiple users, or accounts for anyone but the owner.

**Anti-goals** (failure even if everything "works")
- Any path where a password, or the key that unlocks them, reaches Cloudflare or
  any other third party in readable form.
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

**Header.** Format version, KDF params, salt, `passwordWrap`, `recoveryWrap`. No
secrets in readable form.

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
(`ClipDescription.EXTRA_IS_SENSITIVE`) and clears it after 30 s. Check on the
device that clearing works when the app is in the background. If it doesn't,
rely on the sensitive flag and say so in the toast. Also check whether the
phone's keyboard keeps the clip in its own clipboard history despite the flag.

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
- Every other call takes `Authorization: Bearer <loginToken | recoveryLoginToken>`.
  The Worker hashes it and compares in constant time, the same way as the
  store-api `safeEqual`. No sessions.
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
re-encrypted, new wraps, then a full upload. Phase 2 adds it.
*(Reviewer's point, adopted.)*

**New device**: enter the master password → prelogin → derive keys → download header and records → unlock.

**Open question for the owner, before Phase 2 is planned**: today the master
password alone protects the server copy, so a D1 leak allows offline guessing,
and a fake unlock screen could phish it. Option: add a 128-bit **account key**,
generated at setup and mixed into the derivation with the master password (two
secrets), typed once on each new device. Adding it later only re-wraps
`passwordWrap`. Phase 1 adds only the common-password check (§6). *(Reviewer's
point; the owner decides.)*

**Accepted limits** (single owner, own account): the server could withhold or
roll back records, or delete them. It can't read or forge them. Every device's
local copy is the defence against loss.

## 11. Browser extensions (Phases 3–4), design level only

- One WebExtension code base (Manifest V3) for Chrome, then Firefox. TS vault
  logic in a new pure package, `packages/strongroom-core`, Hermes-safe like
  `open-tunnel-core`, so a future iPhone app can reuse it. It passes the shared
  test vectors.
- Content script detects login forms and shows a fill suggestion. On submit it
  offers save/update. Matching follows the same rules as §7.
- The vault key is held only in `chrome.storage.session` (memory) while unlocked.
  The encrypted vault is cached in `chrome.storage.local`. Same auto-lock times.
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
