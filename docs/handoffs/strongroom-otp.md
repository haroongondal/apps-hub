# Handoff: Strongroom OTP (authenticator codes and SMS code fill)

## Resume prompt

Dated 2026-11-15, last updated 2026-11-19 (Tasks 1–8 code-complete and gated;
Task 7's flow E2E and Task 8's entry-screen code were verified on the owner's
phone over adb — see their sections).
Implements `docs/strongroom/DESIGN.md` §15 per `docs/strongroom/OTP-PLAN.md`. Work happens
in a worktree off `main` (226a947) on branch `strongroom-otp` — this run used
`/Users/outsentia/.local/share/opencode/worktree/044235/strongroom-otp`; any
fresh worktree off the same branch is equivalent. The branch has seventeen
commits (this handoff's included):
f2d7684 (DESIGN §15 + OTP plan), fb3a7fd (Task 1, `Otp.kt` + vectors), 7e1a1c0
(Task 2, the vault field, both languages), 19edffcd (Tasks 1–2 handoff),
565066c (Task 3, code-field detection), eb473da (Task 4, TOTP fill datasets),
72d6bec (Task 5, SMS fill), ba36251 (Task 5 fix, an armed delayed fill is a
response), 2c202a4 (Task 5 handoff), 9844f85 (Task 6, the QR scan screen),
f1896761 (Task 6 handoff), b6e568b (Task 7 Step 0), a106286 (Task 7, the
migration reader + module + vault), 935120c (Task 7, the RN import flow),
249c133e (Task 7 handoff), 268c8d5c (Task 8, the entry-screen code, remove and
disk check). Tasks 1–6 are done and E2E verified (emulator);
Task 7 is implemented, gated, and its import flow verified on the phone — the
on-camera QR part stays JVM-proven; Task 8 is implemented, gated, and verified
on the phone (see its section). The OTP plan is closed.
Never merge or release without the owner's word.
The branch is pushed and PR #51 (https://github.com/haroongondal/apps-hub/pull/51)
is open against `main`.

Read first: `docs/strongroom/OTP-PLAN.md` (the task list — one task at a time,
committed and reviewed before the next), then `DESIGN.md` §15, then
`docs/handoffs/strongroom.md` (the app's background: phone facts, emulator,
Store rules). Bound rules: Kotlin owns all vault and OTP logic, RN renders
only; JVM tests via `:strongroom-vault:testDebugUnitTest`; `node --test` for
TS; `coord claim apps/strongroom` before any build-install-test loop; on the
phone (owner's word, 2026-11-18): E2E runs over adb on the owner's phone —
only ever the side-by-side test build (`-PstrongroomIdSuffix=.synctest`, app
name "Strongroom test"), never the Store app `com.haroon.strongroom` or its
data, and coord-queue the device (`device:49kjmnuwonkffqzh`) around any
install/tap; the emulator is the fallback (owner: "use mobile over adb
instead of emulator"); no commit attribution lines; explicit `git add`
pathspecs.

**Task 3 note (resolved):** an earlier version of this handoff warned about a
then-uncommitted password-generator iteration on `FormDetector.kt` in the main
checkout. It landed on `main` as 226a947 before this branch was cut, so Tasks
3–5 built on it with no conflict.

## Scope and decisions (owner, 2026-11-15)

- Feature set: TOTP codes stored on logins, autofilled into code fields; QR
  scan to add secrets; Google Authenticator migration import; SMS code fill.
- Declined: paste-in `otpauth://` URI entry, HOTP (counter-based) support.
- Locked vault: offer **nothing** for TOTP fields (codes are vault content).
  SMS code fills work while locked, because SMS codes are not vault content.
- SMS mechanism: `RECEIVE_SMS` permission (owner's choice over Play-services
  `SmsCodeAutofillClient` and notification listeners) — reliability without a
  Google/proprietary dependency. Play Protect may flag the install on the
  owner's phone (DESIGN §15.3); installs go through the private Store.

## Where the format landed (§15.1)

- `Entry.Login` gains optional `totp: String?` / `totp?: string` — the whole
  `otpauth://totp/` URI exactly as scanned, stored as scanned.
- Strict at the edges: the Kotlin type validates on construction; both
  decoders re-validate and a record with an unreadable URI decodes to null
  (fail closed); the CSV importer refuses the row with a message naming the
  row number but never the URI.
- Encode writes the key only when set — absent, never null (older readers
  throw on unknown-null via `optString`; the new `absentOrNull` reader is the
  optional-field pattern). Key order: `…,note,totp,updatedAt` — pinned by
  `EntryJsonTest.encodingPinsFieldNamesAndOrder` and the shared vectors.
- Bounds and refusals live in `Otp.kt`/`otp.ts` with identical message text
  (the scan screen shows them on both ends): secret 10–64 bytes, SHA1/256/512,
  digits 6|8, period 15–120, unknown parameters ignored, `+` stays literal,
  malformed escapes refuse. Both ends must refuse exactly the same URIs —
  when touching either parser, port the change across and extend both tests.

## Task state

- **Task 1 done** (fb3a7fd): `Otp.kt` — base32, strict `otpauth://totp/`
  parse, TOTP codegen (RFC 6238 vectors checked in, 6-digit and period-edge
  rows recomputed by `tools/vectors/otp_vectors.py`). 407 module tests green.
- **Task 2 done** (7e1a1c0): the vault field on both ends.
  - Kotlin: `Entry.Login.totp` + init validation, `absentOrNull`,
    `EntryJson` encode/decode, `CsvExport` totp column (last), `GoogleImport`
    reads/validates with `ImportError`.
  - TS: `packages/strongroom-core/src/otp.ts` (parse/refusal/base32 port,
    **no codegen** — deferred to the extension-fill phase), `entry.ts` field +
    strict decode, `google-import.ts` totp column, barrel export.
  - Shared vectors: new record id 5 / nonce 7
    (`otpauth://totp/Example:me@example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Example`,
    RFC 6238's "12345678901234567890"), record kinds now
    `login, login, card, note, deleted` — `VaultFormatTest` asserts that
    order; keep the assertion in sync with `VectorGen`'s list.
  - Gates at commit: Gradle module suite 411 tests / 0 failures / 1 skipped
    (the regen guard); workspace `pnpm test` and `pnpm typecheck` exit 0
    (strongroom-core 154, extension 70, vault-api 20).
- **Task 3 done** (565066c): `FormDetector.DetectedForm.otp: List<Int>` before
  `confirm`; the keyword path bounds the regex, requires a numeric field and
  `maxLength in 4..8`, and password boxes veto to `Role.OTHER` at the same
  rank; Chrome's hyphenated `"one-time-code"` hint maps in `HINT_ROLES`.
- **Task 4 done** (eb473da): `core/TotpFill.logins(entries, requester,
  unixSeconds)` (§7 matching, sorted by name, skips unparseable entries);
  `Datasets.code(...)` shares its private `same()` with `suggested`;
  presentation `code · name`; unlocked vault only, no SaveInfo.
- **Task 5 done** (72d6bec + ba36251): `core/SmsCodes` extraction (4–8 digit
  run, or an alnum run holding a digit, nearest keyword within NEAR=24; digits
  beat alnum; letter-only never a code); volatile cache MAX=4 / TTL 2 min with
  strict `>` expiry; `SmsReceiver` on `SMS_RECEIVED` only; `SmsFill` arms the
  delayed fill (`FLAG_DELAY_FILL` + `request.delayedFillIntentSender`) and
  completes via `EXTRA_FILL_RESPONSE` + `sendIntent`; ba36251 made an armed
  response set `any = true` so it is never dropped as empty.
- **Task 5 E2E verified on the emulator** (2026-11-17 — details in the next
  section): delayed fill and cache path both fill a Firefox field; the
  disk and logcat nothing-persisted gates pass.
- **Task 6 done** (9844f85): the §15.4 scan screen, native end to end.
  - `android/ScanActivity.kt` (new): `DecoratedBarcodeView` restricted to
    `BarcodeFormat.QR_CODE`; `FLAG_SECURE` + `hideOverlayWindows` +
    `NO_EXCLUDE_DESCENDANTS` + `accessibilityDataSensitive` (API 34+);
    CAMERA requested at scan time via `registerForActivityResult`;
    decode → `Otp.parse` → confirm screen (parsed issuer · account,
    algorithm/digits/period, "Add this code" / "Scan again" / persistent
    Cancel) or refusal (message from `Otp.refusal`, "Try again" resumes
    the paused camera); permission-denied screen ("Open settings" into App
    info); result `putExtra(SCAN_TOTP_EXTRA, totp.raw)` with
    `filterTouchesWhenObscured` on every button. Own palette() from prefs
    (bg/text/muted/accent/onAccent/danger), like UnlockActivity.
  - Module: `AsyncFunction("scanQr")` — launches `ScanActivity`
    (`startActivityForResult`, code 7403), resolves via `OnActivityResult`
    → `{raw, issuer, account, algorithm, digits, period}`, `null` on
    cancel; re-parses the returned URI (defence in depth). `pendingScan`
    parallels `pendingPick`; a second scan resumes the first with null.
  - Save plumbing tri-state in `EntryInput.toEntry`: absent key keeps the
    stored code, `""` removes it, a URI replaces it; invalid URI → coded
    `BAD_TOTP`. `view()` exposes `totp` display info only (issuer, account,
    algorithm, digits, period — never the raw URI/secret).
  - TS surface: `TotpInfo`, `EntryInput.totp?` (tri-state comment),
    `EntryView.totp?`, `scanQr(): Promise<(TotpInfo & { raw: string }) | null>`.
  - RN: `EditScreen.tsx` login section gains an "Authenticator code" row —
    disabled Field showing `issuer · account · N digits, every N s`, hint
    when unset, ghost buttons "Scan QR code"/"Replace QR code"/"Remove
    code"; `draft.totp` null (keep) / `''` (remove) / raw URI (set), so the
    scanner result is stored only by the Add/Edit save.
  - Manifest: `CAMERA`, `uses-feature` required=false (cameraless phones
    install), `ScanActivity` exported=false excludeFromRecents;
    `build.gradle`: `com.journeyapps:zxing-android-embedded:4.3.0` (the
    feature's only new dependency, Apache-2.0, pre-approved by name in
    DESIGN §15.4 — brings zxing core 3.4.1 transitively).
  - Tests: `QrRoundTripTest` (zxing encode→decode→`Otp.parse` pipeline,
    including a foreign QR refused), `EntryInputTotpTest` (the tri-state);
    the app manifest invariant test pins `CAMERA` with its rationale.
  - Gates at commit: Gradle module suite 436 tests / 35 suites / 0 failures
    (431 + the 5 plumbing tests); workspace `pnpm test` and
    `pnpm typecheck` exit 0.
- **Task 6 E2E verified on the emulator** (2026-11-17 — see the section
  below): permission dialog both ways, scan screen, Cancel-null, the
  denied screen with Open settings, and the `FLAG_SECURE` black-screencap
  invariant. The decode→confirm screen is JVM-proved
  (`QrRoundTripTest`); the real-camera proof stays with the owner's phone.
- **Task 7 done** (a106286 native + 935120c RN flow): the Google Authenticator
  `otpauth-migration` import, end to end in Kotlin with the RN flow driving it.
  - Step 0 (b6e568b) checked a real export first — see the Step 0 bullet
    below; **its payloads were lost on 2026-11-18** when the session server
    restart wiped the temp dir (the export dir was under
    `<temp>/opencode/otp-export/`, nothing was committed). Re-derive from the
    owner's phone if the real-QR proof is ever needed.
  - `core/MigrationImport.kt` (new): own protobuf reader (own-code rule) —
    `parse(uri)` percent-decodes `data`, base64-decodes it, walks the
    MigrationPayload (`entries` ≤ 10, `version` read and ignored, `batchSize`
    1..MAX_BATCHES, `batchIndex` in range; type-safe reads — a varint where
    bytes belong is damaged data, refused cleanly); unknown fields skipped
    including fixed-size wire types 1/5, bounds-checked; `delimited` length
    is checked as `len > msg.size - after` (no overflow). `review(batches,
    existing)` applies §15.1 bounds per entry (secret 10..64 B, algorithm
    SHA1/SHA256/SHA512, digits 6/8, period 30 — HOTP (type 1) is skipped and
    counted), dedupes against existing logins by issuer+account (attach
    target) and against the batch itself, orders batches by index then entry
    order, and returns `Review(created, attached, duplicates, hotp, bad,
    items)` where `Item` is `Create(loginName, username, totp, …)` or
    `Attach(loginId, loginName, totp, …)` — the attach item carries the URI
    so the commit can write it. Bounds are not re-checked here: `uriOf`
    builds the URI and `Otp.parse` stays the single validator (§15.1 secret
    10–64 B, SHA1/SHA256/SHA512, 6/8 digits; a null URI counts bad). Period
    is always 30 — migration has none. The parse-level sanity caps are
    looser (`MAX_BATCH_ENTRIES` 100, `MAX_BATCHES` 500, `MAX_SECRET_BYTES`
    128). `uriOf(params)` builds
    `otpauth://totp/<label>?secret=…&issuer=…&algorithm=…&digits=…&period=…`
    percent-encoded; every built URI round-trips through `Otp.parse` (tests
    prove it). The parsed URI is the single source of truth for issuer and
    account.
  - `Vault.putMany(List<Pair<String?, Entry>>)` (new overload): one
    transaction — null id creates stamped `now`, a set id is an attach-edit
    stamped `now + 1`, so a same-call attach never joins the import group a
    later `deleteImport` removes. The old `List<Entry>` overload got
    `@JvmName("putManyEntries")` (JVM erasure clash). `imports(known)`
    semantics confirmed by test: a stamp counts when shared by >1 entry OR
    when the caller passes it in `known` — the module passes the import log's
    stamps, which keeps single-create imports visible (the log's stamps are
    written by `commitAuthenticatorImport`).
  - `ScanActivity`: `SCAN_MODE` extra with `MODE_TOTP` / `MODE_MIGRATION`;
    the migration branch shows the multi-QR heading ("Point the camera at
    each QR of the Authenticator export, one after another."), confirms each
    batch with "Batch scanned." → "Next QR", and refuses a foreign QR with
    "This QR is not an Authenticator export code." Cancel keeps batches
    scanned so far.
  - Module: `AsyncFunction("scanAuthenticatorBatch")` scans one batch,
    decodes on IO, accumulates raw URIs by `batchIndex` in
    `VaultHolder.pendingMigration` (a re-scanned index replaces its batch;
    `pendingMigrationSize` must match — a `MIGRATION_STATE` coded error
    otherwise; failed scans never mutate state), and returns
    `AuthenticatorProgress {scanned, total, entries, hotp}` — null on
    cancel. `authenticatorReview()` runs the review (`MIGRATION_INCOMPLETE`
    coded error until every batch is scanned), stores
    `pendingMigrationReview`, and exposes kind/login/issuer/account only —
    the raw URIs never leave Kotlin. `commitAuthenticatorImport()` seals one
    transaction (`NO_MIGRATION` / `MIGRATION_EMPTY` coded errors), writes the
    import log counting **created only** under the name "Google Authenticator",
    and clears all pending state. `cancelAuthenticatorImport()` drops it.
    `VaultHolder` pending fields clear on lock, as `pendingScan` does.
  - TS surface: `AuthenticatorProgress`, `AuthenticatorReview`/`Item`
    (`kind: 'create' | 'attach'`, never the URI), `AuthenticatorCommit`;
    `scanAuthenticatorBatch(): Promise<Progress | null>`,
    `authenticatorReview(): Promise<Review>`,
    `commitAuthenticatorImport(): Promise<Commit>`,
    `cancelAuthenticatorImport(): void`.
  - RN: `src/AuthenticatorImportScreen.tsx` (How steps, "Scan the first QR" →
    "Scan QR N of M", progress + skipped rows, review list with attach rows
    ("Adds the code for …") and create rows, "Left out" counts
    (duplicates/HOTP/bad), Import button, done Notice warning that anyone
    who scans the export QRs gets every code, restart paths — entering fresh
    cancels an abandoned run, a `MIGRATION_STATE` error auto-restarts with
    the Notice shown, Cancel from the scan screen keeps scanned batches,
    Back mid-flow restarts); `SettingsScreen` row "Import from Google
    Authenticator" + flow `'authenticator'`; `App.tsx` route.
  - Tests: `MigrationImportTest` 25 (format shape from Step 0, unknown and
    fixed-size field skips, truncated fixed64/varint-where-bytes refusals,
    `uriOf` round-trips incl. non-Latin issuer, review: HOTP skip count,
    out-of-range entries counted not crashed, dedup, attach rules — second
    code for the same login, attach when the login already has a code,
    attach target vanished between review and commit — batch ordering,
    issuer-less naming); `VaultTest.putManyPairsKeepAttachEditsOutOfTheImport`
    (one store write; the attach-edit keeps its +1 stamp out of the import
    group; `imports(known)` shows the create; `deleteImport` removes only
    the create); `ModuleErrorsTest` pins `emptyList<Entry>()` (overload
    ambiguity).
  - Gates at commit: Gradle module suite **462 tests / 0 failures / 1
    skipped**; workspace `pnpm -r --workspace-concurrency=1 test`
    (112 + 95 + 149 + 33, 0 fail) and `typecheck` exit 0.
- **Task 7 Step 0 — real export checked** (2026-11-17, owner's Authenticator,
  two batch QRs photographed, decoded on the host with a throwaway macOS
  Vision script; payloads kept only in the session temp dir, never
  committed):
  - Two batches — `batch_size = 2`, indices 0 and 1; 15 accounts total
    (index 0 carried 10 entries, index 1 carried 5, so the last batch may
    be short). "N of M scanned" = `batch_index + 1` of `batch_size`.
    (The payloads lived only in the session temp dir and were wiped by the
    2026-11-18 server restart — see the Task 7 done bullet.)
  - **Top-level `version` is 2** in the wild (older docs say 1) — the
    reader must not enforce a version, just read and ignore.
  - Every entry is TOTP / SHA1 / 6 digits (type 2, algorithm 1, digits 1);
    **no HOTP, no counter field (7) anywhere** — the HOTP skip path stays
    a synthetic fixture.
  - Secrets run 10–40 bytes, all inside our §15.1 bounds; two are exactly
    the 10-byte floor. Short fields in the batch are account *names*
    (5–30 chars), not secrets — the wrong turn to avoid: field 2 of
    `OtpParameters` is the name, field 1 is the secret.
  - Several entries carry **no issuer** (name only) — the review list and
    the new-login naming must handle issuer-less entries.
  - **Every entry has an unknown trailing field 8** (19 bytes, length-
    delimited) — the reader must skip unknown fields like `Otp.parse`
    does. No field 7, no groups; pure wire types 0 and 2.
- **Task 8 done** (268c8d5c): the §15.5 entry screen and the disk-check
  needle; the whole-feature §12 gate-4 review is recorded in the Task 8
  section.
  - `Otp.State(code, secondsLeft, period)` + `state(totp, unixSeconds)`:
    `secondsLeft` = period − (t mod period), so a fresh window reads 30 and
    the last second reads 1, never 0; `OtpTest.stateCountsDownAndNeverReadsZero`
    pins 30/29/1, the code at the boundary, and an 8-digit code.
  - Module: `Function("totpCode")` → `{code, secondsLeft, period}` via a new
    `currentTotp(vault, id)` (coded `NO_TOTP` when the login has none);
    `removeTotp(id)` rewrites the login without its code (password untouched,
    index refreshed); `copy` accepts field `"totp"` (same SensitiveClipboard
    path as passwords). The stored string is re-parsed on each read, so a code
    that no longer parses is refused like a missing one.
  - TS: `TotpCode`, `totpCode(id)`, `removeTotp(id)`, `copy` union gains
    `'totp'`, `NO_TOTP` added to the rejection comment.
  - RN `EntryScreen`: an "Authenticator code" row at the top of a login's
    fields — `Readout` showing the code grouped like Authenticator apps
    (`123 456` via the new `groupCode` in `forms.ts`; 8-digit codes split
    4/4), "N seconds left" under it, ghost Copy; one `setInterval` tick a
    second re-reads `Vault.totpCode(id)` and rolls the code itself; the row
    disappears when the entry has no `totp`; "Remove code" opens a Sheet
    ("Remove this code?", danger "Remove code") and the success Notice says
    the password is unchanged.
  - `tools/disk-check.sh`: a `b32:<base32>` needle — its text in either case
    and the raw bytes it decodes to (host-side python3 base32; run-as can't
    run one on the phone), plus the usual plain/UTF-16/Base64 passes for the
    text form; usage comment updated.
  - Gates at commit: Gradle module suite **463 tests / 0 failures / 1
    skipped** (the new state test); workspace
    `pnpm -r --workspace-concurrency=1 test` all `fail 0`; `pnpm typecheck`
    Done in every package.
  - Phone proof (live code, copy, remove) and the disk-check output are in the
    Task 8 section. With this, every §15 claim has a phone or JVM proof; the
    migration heading, batch confirmations and foreign-QR refusal stay
    JVM-proven (the scan screen is FLAG_SECURE and no export QR can be fed
    to the camera).

## Task 5 E2E on the emulator (verified 2026-11-17)

Setup: AVD `strongroom-task12` (`emulator-5556`, API 35), Strongroom is the
autofill service with `RECEIVE_SMS` granted and `smsFillEnabled=true`; test
pages served by `python3 -m http.server 8123` from a host dir, loaded in
Firefox (`org.mozilla.fennec_fdroid` 158.0.2, the sanctioned stand-in —
Mozilla's cert matches `Browsers.ALLOWLIST`) at `http://10.0.2.2:8123/…`.
SMS recipe:
`adb -s emulator-5556 emu sms send +15551234567 "Your verification code is 482913"`.

Verified flows, both on `otp2.html` (username + password + a `type="number"`
code field labelled "Verification code" — see the browser findings for why):

1. **Delayed fill (482913).** Focus the code field → session starts →
   `onFillRequest` arrives with a `delayedFillIntentSender` → our response
   sets `FLAG_DELAY_FILL` (`Service requested to wait for delayed fill
   response`) → the SMS lands → the system unfreezes our service process,
   `SmsReceiver` runs, `SmsFill.complete` sends the delayed response with the
   dataset `Fill 482913 · SMS` → the popup appears over the focused field →
   tap → the field holds `482913` with Firefox's autofill highlight.
2. **Cache path (571243).** A second SMS while nothing is armed just populates
   the volatile cache; loading a fresh document starts a new session and the
   response carries the cached dataset as a Gboard inline chip
   `Fill 571243 · SMS` → tap → the field holds `571243`.
   (Refocusing within the *same* session only re-presents the current
   response without a new `onFillRequest` — exercise the cache through a
   fresh page load.)
3. **Nothing persisted.** `tools/disk-check.sh emulator-5556
   com.haroon.strongroom 482913 571243` → 0 hits in 20 files. Logcat over
   both arrivals and both fills: no message body, no code digits — the system
   logs dataset values only as `value=6_chars`, and our receiver and service
   log nothing.

### Browser (GeckoView) findings — why the test page looks like it does

- **Firefox 158 only engages autofill on login forms.** Registration triggers
  are `DOMFormHasPassword`, `DOMInputPasswordAdded`, and a `pageshow` scan
  that looks only at `input[type=password]`
  (`mobile/shared/actors/GeckoViewAutoFillChild.sys.mjs`). An OTP-only page
  never registers → no session → nothing notifies. `otp.html` (a lone
  `type="text" autocomplete="one-time-code"` input) therefore cannot trigger
  on Firefox; that is a GeckoView limitation, not ours. Chrome needs ≥ 131
  for third-party autofill at all and passes autocomplete tokens as hints
  directly — it stays the primary target.
- Inside a registered login form, Firefox drops plain `type="text"` fields
  that are not the detected username, so a text OTP input vanishes there too.
  **`type="number"` fields pass** and arrive as `TYPE_CLASS_NUMBER` with no
  autofill hint — our keyword path (numeric gate + "Verification code" label)
  classifies them, and `autocomplete="one-time-code"` additionally arrives as
  an HtmlInfo attribute (the `RANK_AUTOCOMPLETE` hit). **Never use
  `type="tel"`** in test pages: it becomes `AUTOFILL_HINT_PHONE`, which
  `HINT_ROLES` maps to `Role.OTHER`.
- Observed quirk (open, revisit in Task 8): on the combined login+OTP form
  the username text field never reached the autofill structure — the
  locked-vault auth dataset and SaveInfo targeted only the password field id,
  while a login-only page (`login.html`) delivered both. Our detector cannot
  see fields Firefox does not deliver (its plain-text fallback guarantees a
  hit only when the node exists). Locked-vault cosmetic; re-check with an
  unlocked vault during Task 8's login-fill verification.
- `FLAG_DELAY_FILL` semantics observed on API 35: the system holds the whole
  fill UI (including the armed response's other datasets, like the cache
  chip) until the delayed fill completes or a timeout (~1–2 min) lapses.
- App-side probes are not valid triggers: `MainActivity` sets
  `android.R.id.content` to `NO_EXCLUDE_DESCENDANTS` (commit 6724726), so the
  app's own fields never notify autofill.

### Emulator tooling notes

- Screenshots go fully black (not even a status bar) while the RN app's
  `FLAG_SECURE` window is anywhere in the stack — `am force-stop
  com.haroon.strongroom` before browser screenshots; the autofill service
  process restarts on demand afterwards and Firefox sessions keep working.
- The emulator's autofill state can go stale after the service is
  reinstalled or force-stopped: no sessions fire for any client until the
  impl is recreated (reboot the emulator, or force-stop and let the system
  rebuild it). Diagnosed via client-side `AutofillManager` verbose logs.
- Firefox first-launch prompts to dismiss: default-browser role dialog
  (enabled button ≈ 603,1616 device px), notifications "Not now" ≈ 540,1874.
- Screenshot scale: 1080×2400 device, captures render 900 wide (×1.2). On
  `otp2.html`: username ≈ (246,422), password ≈ (246,581), code ≈ (246,739)
  in device coordinates.
- Dev-mode red screen `Cannot find native module 'StrongroomVault'` is a
  Metro reconnect race after the app process restarts (`[runtime not
  ready]`); RELOAD in the overlay fixes it. Not a product bug.
- `otp.html` and `login.html` live in the host test-page dir next to
  `otp2.html`, with all E2E screenshots.

## Task 6 E2E on the emulator (verified 2026-11-17)

Setup: a server restart mid-run killed the emulator, Metro and the test-page
server, so the AVD came back as a **fresh state** — app and Firefox gone.
Rebuilt: installed the 9844f85 debug APK, granted `RECEIVE_SMS` via adb
(app stopped), set `settings put secure autofill_service
com.haroon.strongroom/…StrongroomAutofillService`, and created a fresh vault
(master password `scan-qr-vault-pass-1`, recovery key
`GEB3-FOXU-C6EK-PWKB` / `2K7K-ITA3-MEUU-CNN7` — group 5 is `2K7K`;
fingerprint, Chrome autofill and Google import skipped). Firefox is absent,
so this E2E is app-only; the browser flows from Task 5 remain the recorded
evidence.

Verified flows:

1. **Add screen.** The login section renders "Authenticator code" with the
   hint and the "Scan QR code" ghost button (after a swipe-up — it sits
   near the dev banner).
2. **Grant path.** Scan → system dialog "Allow Strongroom to take pictures
   and record video?" → "While using the app" → the scan screen opens:
   heading, live virtualscene camera preview filling the screen, persistent
   Cancel. (Camera granted only through the dialog — see the `pm` gotcha.)
3. **FLAG_SECURE.** `screencap` while the scan screen is open: a 23 KB PNG
   whose pixels are pure black except the status bar band (y 0–199) —
   decoded by hand (no PIL) since the camera preview would make it hundreds
   of KB. Matches the app-wide invariant.
4. **Cancel = null.** Cancel from the scanning state returns to Add with
   the field still showing the hint — no code set, draft untouched.
5. **Denied path.** CAMERA revoked via adb while the app was stopped; Scan
   → dialog → "Don't allow" → the denied screen: "Strongroom can't scan
   without the camera. Allow the camera permission for Strongroom in the
   phone's settings." + "Open settings" (primary) + Cancel. "Open settings"
   lands on the App info page; going back preserves the denied screen
   (`onResume` doesn't re-request); Cancel returns to Add, nothing set.
6. **Not verifiable on the emulator:** the decode→confirm screen and the
   refusal/"Try again" resume. The virtualscene camera can't be fed a QR
   (and the emulator console auth refused scripted sessions), so those
   screens are exercised by `QrRoundTripTest` (zxing encode→decode→
   `Otp.parse`, including a foreign QR's refusal) and stay for the owner's
   phone as the real-camera proof.

## Task 7 flow E2E (2026-11-18 to 19 — on the phone)

The owner's word this run: **"use mobile over adb instead of emulator"** —
the flow E2E runs on the owner's phone (Xiaomi 24116RACCG, Android 16)
over adb, with the coord queue guarding the device. The emulator part of
the run, for the record:

- The session server restart killed the emulator and Metro mid-setup; on
  relaunch the previously created vault (`scan-qr-vault-pass-1`) was
  **rejected twice** — userdata apparently rolled back to an older vault
  state around the emulator's crash. The vault was empty test data, so the
  clean reset was `pm clear` (app stopped), `RECEIVE_SMS` re-granted,
  autofill service re-set, fresh setup begun with `otp-import-pass-1`.
- During setup's Continue, the app **ANRed** ("Strongroom isn't responding")
  under heavy host load (system_server/systemui GCs taking seconds in
  logcat); "Wait" didn't clear it and the system killed the process
  (signal 9). Rather than fight a starved emulator, the E2E moved to the
  phone.
- Build recipe proven for the phone: `-PstrongroomIdSuffix=.synctest
  -PstrongroomScreenshots=true` — the second property flips
  `BuildConfig.ALLOW_SCREENSHOTS`, so `MainActivity` skips `FLAG_SECURE`
  and every screen except `ScanActivity` (secure unconditionally, the QR
  in view is a secret) can be captured. `:app:assembleDebug` in 3 m 11 s,
  app name "Strongroom test", id `com.haroon.strongroom.synctest`,
  installs beside the Store app without touching the owner's vault.

Phone run results (2026-11-19, USB serial `49kjmnuwonkffqzh`; the device
queue had to be re-entered after a server restart — apps-hub-46 lent it,
then 66/63/1f took turns; released to apps-hub-1f at the end):

- **Vault state surprise:** the test app's vault was no longer the empty
  vault set up on 2026-11-18 — it held what looks like real account data
  (Amazon Web Services ×2, Binance, carta, Deel, GitHub, Google; e.g.
  `haroonmukhtar4@gmail.com`). Presumably pulled in by another session's
  testing or sync; it was treated as read-only. The 2026-11-18 password
  `otp-import-pass-1` still unlocked it (5-minute auto-lock had fired:
  unlock screen, field native ≈ (540,558), Unlock ≈ (540,768)).
- **Flow verified live:** Settings → "Import from Google Authenticator"
  row → flow screen (How steps, "Scan the first QR") → Scan with CAMERA
  already granted (no dialog; the intent from the 2026-11-18 dialog grant
  persisted, `granted=true, USER_SET`) → `ScanActivity` focused →
  screencap **black** (FLAG_SECURE holds on the phone, 27 KB) → Cancel →
  MainActivity, flow re-rendered "Scan the first QR" (cancel with no
  batches keeps the start state) → flow Back → Settings.
- **Cancel tap point:** native ≈ (540,2232) hits the button; (540,2160),
  which worked on 2026-11-18, lands above it on this panel — measure from
  a fresh capture or prefer `keyevent 4` (no back override, BACK finishes
  like Cancel).
- **Not verified on device:** the migration heading ("Point the camera at
  each QR…"), batch confirmations ("Batch scanned." → "Next QR") and the
  foreign-QR refusal — `ScanActivity` is FLAG_SECURE by design, so its
  pixels can never be captured, and no export QR can be fed the real
  camera (the Step 0 payloads were lost; only the owner's Authenticator
  can regenerate them). This part stays proven by `MigrationImportTest`
  + `ModuleErrorsTest` + code review; re-derive a real export if the
  end-to-end QR proof is ever wanted.
- Wrap-up after the run: the app returned to the launcher, the
  screenshots were deleted, the device was released (`coord release`).
  The test app stays installed beside the Store app; its vault keeps the
  data found above.

## Task 8 E2E on the phone (verified 2026-11-19)

Same side-by-side test build as Task 7 (`-PstrongroomIdSuffix=.synctest
-PstrongroomScreenshots=true`), installed over the previous one with
`adb install -r` (the reinstall locks the vault; `otp-import-pass-1` unlocks
it). The test entry came from a Google CSV with a `totp` column, because the
camera can't be fed a QR: `strongroom-e2e-code.csv` (pushed to Downloads,
selected through DocumentsUI, never the owner's real export on Recent) with
entry "Strongroom E2E code", `code-test@example.com`, `test-pass-1`, and
`otpauth://totp/E2E:code-test@example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=E2E`
(RFC 6238's SHA-1 test secret). The import preview said "1 login found, 0
duplicates merged"; the entry appeared under its name with a live code.

- **Live code matches an independent TOTP.** With the phone clock at
  t=1795033665 the screen showed `927 446`; a host-side HMAC-SHA1 over the
  same base32 secret and counter (unix/30) gave `927446`. The countdown read
  "16 seconds left", then "11" four seconds later with the same code.
- **Rollover is automatic.** At t=1795033732 (a new period) the screen
  showed `519 777`, matching the host computation for that counter; later
  periods rolled the same way with no interaction (`183 554`, `893 852`,
  `240 590` observed while the run went on). `secondsLeft` never read 0 —
  the last second reads 1 by design.
- **Copy** shows the Notice "Authenticator code copied. The clipboard clears
  in 30 seconds." and leaves the row as it was (the clipboard path is Task
  5's: token + timestamp in prefs, never the code).
- **Remove code.** "Remove code" → Sheet "Remove this code?" (says the
  password stays) → danger "Remove code" → the code row and the Remove
  button disappear, Notice "Authenticator code removed. The password is
  unchanged.", and Show on Password revealed `test-pass-1` — the login's
  other fields were untouched.
- **Disk check with the TOTP secret.** The import appends (it does not
  merge), so re-importing the CSV after the remove-code run put a sealed
  copy of the secret back without the camera; the second entry was deleted
  afterwards. With the secret stored:
  `tools/disk-check.sh 49kjmnuwonkffqzh com.haroon.strongroom.synctest
  test-pass-1 code-test@example.com b32:GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ`
  printed `secret 1, plain: 0` / `plain or UTF-16: 0` / `Base64: 0` (password),
  the same three zeros for the username, `secret 3, base32 text or raw
  bytes: 0`, and `0 hits in 16 files …`, exit 0. The knob that makes this
  meaningful: the needle covers the base32 text in either case and the raw
  bytes it decodes to, not just the stored URI.
- **Cleanup:** both test entries were deleted through the UI (the list is
  back to the data the vault held before this run), the pushed CSV was
  removed from Downloads, the screenshots were deleted, the app returned
  to the launcher, and the device was released (`coord release`). The test
  app stays installed beside the Store app.

### §12 gate 4 — review of the §15 additions

- **TOTP code generation.** The code is derived in Kotlin per read
  (`Otp.state` → `currentTotp`), never cached to disk; the bridge carries
  `{code, secondsLeft, period}` only, so the raw URI/secret never reaches
  RN. `removeTotp` is a field edit on the login, not a password edit, and
  goes through the same sealed `put`. The disk check above is the
  on-device proof that the secret is not readable on disk.
- **QR scan screen.** `ScanActivity` sets `FLAG_SECURE` unconditionally
  (not behind the screenshots build flag), hides overlay windows, marks
  itself `accessibilityDataSensitive`, and holds the scanned URI only in
  the activity result. The confirmation screen (issuer · account,
  algorithm/digits/period) is inside that secure activity; the URI is
  re-parsed in the module (`SCAN_BAD_URI`) before it can be saved.
- **Migration import.** Pending batches and the review live only in
  `VaultHolder` volatile fields; the raw URIs never cross the bridge, and a
  lock clears every pending field (`VaultHolder` lock listener) so a later
  unlock cannot commit a stale export. `commitAuthenticatorImport` writes
  one transaction and clears the pending state.
- **SMS receiver/delayed fill.** `SmsReceiver` reads only the incoming
  `SMS_RECEIVED` broadcast (never the inbox/MMS), extracts the code through
  `SmsCodes` into an in-memory deque (max 4, each gone after 2 minutes) and
  writes nothing — no message text, no code, no log line. The only persisted
  SMS-related value is the toggle boolean (`SmsToggle` prefs). The armed
  fill lives in `SmsFill`'s volatile `session`; a dead process loses it.
- **Clipboard.** The code is copied through `SensitiveClipboard` like a
  password: the clip is marked sensitive, prefs hold only a UUID token and
  a timestamp, and the 30-second clear runs through `ClipClear`.

## Gotchas learned the hard way

- **`pm grant`/`pm revoke` on a running app kills its process.** Bit once
  during the Task 6 E2E: revoking CAMERA while the scan flow was open tore
  down the app mid-permission and left a dev error screen. Grant through
  the dialog UI; revoke only while the app is stopped.
- **Cold emulator boot breaks the first Metro connect.** First launch fails
  with `failed to connect to /10.0.2.2 (port 8081) … after 5000ms` → RN
  falls back to assets → fatal red screen `loadJSBundleFromAssets` that
  RELOAD does not fix. Verify the network first —
  `printf 'GET /status HTTP/1.0\r\n\r\n' | toybox nc 10.0.2.2 8081` must
  answer `HTTP/1.1 200` — then force-stop + `am start`. Even then one
  launch rendered an empty skeleton for ~40 s; a second force-stop +
  start rendered immediately. (`10.0.2.2` pings even when TCP fails, so
  ping proves nothing.)
- **Metro serves from the workspace root:** the bundle URL is
  `apps/strongroom/index.ts.bundle?platform=android&…` — `/index.bundle`
  404s. `curl http://localhost:8081/apps/strongroom/index.ts.bundle?…`
  returning 200 (~5.1 MB) is the "Metro is healthy" check.
- **`expo start` rewrites `apps/strongroom/tsconfig.json` include**
  ("The tsconfig.json#include property has been updated") —
  `git checkout -- apps/strongroom/tsconfig.json` before committing.
- **`FLAG_SECURE` proof without PIL:** a secure window screencaps as a
  tiny PNG (23 KB at 1080×2400); decode IDAT by hand with
  `zlib.decompress` + unfiltering to confirm pure-black pixels except the
  status bar band. Camera preview would be hundreds of KB.
- **Emulator console auth from a piped session is refused** (token file
  read, but the console never accepted it) — no scripted `virtualscene`
  poking; left alone.
- Kotlin `optString` throws on an absent key; `absentOrNull` (Entry.kt) is
  the reader for fields that may be missing entirely.
- TypeScript never-return narrowing does **not** fire after
  `if (x == null) bad();` — write `bad()` in a ternary/`??` position instead
  (the `entry.ts` idiom).
- Vector regeneration (run from `apps/strongroom/android`,
  `STRONGROOM_WRITE_VECTORS=1 ./gradlew :strongroom-vault:cleanTestDebugUnitTest
  :strongroom-vault:testDebugUnitTest --tests '*VectorGen'`) recomputes the
  whole file but preserves the `accountKey` section from the existing file;
  the pretty-printed JSON is escaped to ASCII by `writeVectors`.
- `otp-vectors.json` period edges are the RFC 4226 HOTP sequence (755224,
  287082, 359152, 969429) — an independent truncation cross-check.
- The TS otp grammar tests read the same `otp-vectors.json`; the RFC code
  rows stay phone-only until the extension learns to generate codes.
- Kotlin `Sequence` is lazy and single-use — materialize with `.toList()`
  before iterating twice.
- Android-side files that touch core logic need the explicit cross-package
  import (`expo.modules.strongroomvault.core.SmsCodes`), unlike same-module
  core files.
- JUnit 4 assert messages come FIRST (`assertEquals(msg, expected, actual)`),
  the reverse of some TS runners.
- TTL expiry is strict `>` (`now - cachedAt > TTL_MS`), so a code is usable
  for exactly the full two minutes.
- **Kotlin forbids local functions inside `inline fun`s** — `walk()` started
  inline and the compiler refused its `varint`/`delimited` helpers; made it
  non-inline (payloads are ~1 KB, zero cost).
- JVM `String` has `.length`, not `.size` — `StringBuilder(text.size)` is
  an unresolved reference the K2 compiler only reports at the use site.
- **K2 smart-cast does not survive a nested lambda** inside a `when` branch
  on a sealed type: `(x as? T)?.takeIf { it.f == null }?.let { it.f }`
  loses the smart cast. Restructure with a plain `val` in the branch
  (`val stored = all[id] as? Login; if (stored != null && stored.f == null)`).
- **JVM erasure clash on overloads**: `putMany(List<Entry>)` and
  `putMany(List<Pair<…>>)` are both `putMany(Ljava/util/List;)J` —
  disambiguate with `@JvmName("putManyEntries")` on one (Kotlin call sites
  unaffected), then pin any `emptyList()` call that becomes ambiguous
  (`emptyList<Entry>()`).
- `imports(known)` counts a stamp when **shared by >1 entry OR present in
  `known`** — after a batch import whose attach-edits restamp most entries,
  the lone create is only visible because the module passes the import
  log's stamps as `known`. Tests pin both halves.
- Protobuf reading hardening that mattered: fixed-size wire types 1/5 must
  bounds-check `afterKey + 8/4 > msg.size` (a truncated tail otherwise
  reads garbage or dies with IOOBE); length checks compare
  `len > msg.size - after` (no overflow, unlike `after + len > size`);
  a varint on a known bytes-field must refuse via `as? ByteArray ?: throw`
  (a raw `as` ClassCastExceptions out of `review`).
- **The session server restart wipes the session temp dir** — the Task 7
  Step 0 payloads (`<temp>/opencode/otp-export/`) are gone; nothing secret
  was ever committed, and the real export can only be re-derived by the
  owner's phone.
- **An overloaded host ANRs the emulator app and can corrupt its state**:
  under host GC thrash the Setup Continue hung, "Wait" didn't clear, and
  the system killed the process; afterwards the previously created vault
  password stopped working (userdata rollback suspected). `pm clear` (app
  stopped) + fresh setup is the reset.
- **coord from an OpenCode session**: coord's queue tidy() drops entries
  whose SID has no live `~/.claude/sessions/<sid>.json` — any other
  session's coord call deletes your queue slot mid-run. Fix: keep a
  long-lived keeper process (e.g. a background `sleep`), write
  `~/.claude/sessions/<pid>.json`
  (`{"pid":…,"sessionId":"opencode-…","name":"…"}`), and export
  `COORD_SID=<that sessionId>` for every coord call.
- **Task 8 taps move with the Notice.** On the entry screen "Remove code"
  sits at native ≈ (540,2081) while the Copy notice is shown and
  ≈ (540,1844) without it; the Delete button moves the same way when the
  code row appears. Measure from a fresh capture each time, and re-check
  the sheet's danger button too (≈ (540,2289) for both sheets at
  zsh-provided sizes; the sheet grows with its text).
- **A tap during screen wake can land on the launcher** (or on whatever
  the system brings forward): one "Remove code" tap after a wake did
  nothing, and the Store came to the front by itself mid-run (another
  session's update). Don't tap the Store — `am start` the test app back to
  the front and continue; the app process survives in the background.
- **DocumentsUI's Recent lists the owner's real `Google Passwords.csv`.**
  Always go to the drawer → Downloads → `strongroom-e2e-code.csv`; never
  open or import the owner's export into the test app.
- **The Google import appends, it does not merge.** Re-importing the same
  CSV creates a second entry — useful to put a sealed TOTP secret back for
  the disk check without the camera, but delete the extra entry (and the
  pushed CSV from Downloads) afterwards.
- **`disk-check.sh` needs `ANDROID_HOME` on this Mac** — it defaults to
  `/opt/homebrew/share/android-commandlinetools`, but the working adb here
  is under `/Users/outsentia/Library/Android/sdk`; run it as
  `ANDROID_HOME=$HOME/Library/Android/sdk ./tools/disk-check.sh …`.

## Test commands

```bash
# Kotlin module suite (from apps/strongroom/android):
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
  ./gradlew :strongroom-vault:testDebugUnitTest
# JUnit XMLs: modules/strongroom-vault/android/build/test-results/testDebugUnitTest/
pnpm test && pnpm typecheck   # whole workspace; strongroom-core included
```
