# Handoff: Strongroom OTP (authenticator codes and SMS code fill)

## Resume prompt

Dated 2026-11-15, last updated 2026-11-17 (Tasks 1–6 done and E2E-verified).
Implements `docs/strongroom/DESIGN.md` §15 per `docs/strongroom/OTP-PLAN.md`. Work happens
in a worktree off `main` (226a947) on branch `strongroom-otp` — this run used
`/Users/outsentia/.local/share/opencode/worktree/044235/strongroom-otp`; any
fresh worktree off the same branch is equivalent. The branch has nine commits:
f2d7684 (DESIGN §15 + OTP plan), fb3a7fd (Task 1, `Otp.kt` + vectors), 7e1a1c0
(Task 2, the vault field, both languages), 565066c (Task 3, code-field
detection), eb473da (Task 4, TOTP fill datasets), 72d6bec (Task 5, SMS fill),
ba36251 (Task 5 fix, an armed delayed fill is a response), 2c202a4 (Task 5
handoff), 9844f85 (Task 6, the QR scan screen). Tasks 1–5 are done and E2E
verified (see the Task 5 section); Task 6 is implemented, gated and its
emulator E2E is verified (see the Task 6 section).
No upstream, never push, merge or release without the owner's word.

Read first: `docs/strongroom/OTP-PLAN.md` (the task list — one task at a time,
committed and reviewed before the next), then `DESIGN.md` §15, then
`docs/handoffs/strongroom.md` (the app's background: phone facts, emulator,
Store rules). Bound rules: Kotlin owns all vault and OTP logic, RN renders
only; JVM tests via `:strongroom-vault:testDebugUnitTest`; `node --test` for
TS; `coord claim apps/strongroom` before any build-install-test loop; never
adb-install on the phone — Store releases only, with the owner's word; no
commit attribution lines; explicit `git add` pathspecs.

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
- **Task 7 next** (§15.5): `otpauth-migration` protobuf reader, batches ≤ 10, dedup,
  review list, HOTP skipped with a count, one transaction. **Step 0 done**
  (see below). Emulator ready for it: fresh 9844f85 build installed with
  vault `scan-qr-vault-pass-1` unlocked state above; CAMERA is currently
  **denied** on the emulator (left in that state by the denial-path test —
  grant through the dialog on the next scan).
- **Task 7 Step 0 — real export checked** (2026-11-17, owner's Authenticator,
  two batch QRs photographed, decoded on the host with a throwaway macOS
  Vision script; payloads kept only in the session temp dir, never
  committed):
  - Two batches — `batch_size = 2`, indices 0 and 1; 15 accounts total
    (index 0 carried 10 entries, index 1 carried 5, so the last batch may
    be short). "N of M scanned" = `batch_index + 1` of `batch_size`.
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
- **Task 8:** entry screen live code, Settings entries, disk-check totp
  needle, whole-feature review, gates, handoff update.

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

## Test commands

```bash
# Kotlin module suite (from apps/strongroom/android):
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
  ./gradlew :strongroom-vault:testDebugUnitTest
# JUnit XMLs: modules/strongroom-vault/android/build/test-results/testDebugUnitTest/
pnpm test && pnpm typecheck   # whole workspace; strongroom-core included
```
