# OTP plan: authenticator codes and SMS code fill

Implements DESIGN.md §15 (owner's scope, 2026-11-15): TOTP on logins with
autofill, QR scan, Google Authenticator import, SMS code fill via
`RECEIVE_SMS`. Branch `strongroom-otp`, worktree off `main` (226a947).

Rules that bind every task: Kotlin owns all vault and OTP logic (RN renders
only); JVM tests in `:strongroom-vault:testDebugUnitTest`; `node --test` for
any TS; `coord claim apps/strongroom` before any build-install-test loop;
never adb-install on the phone — Store releases only, with the owner's word.
One task at a time, each committed and reviewed before the next starts.

The checkout this branched from has another session's uncommitted iteration
of the password generator (repeat-box `confirm` field in `FormDetector.kt`
and its test). Task 3 touches the same file: rebase over that change when it
lands on `main`.

- **Task 1 — Otp.kt (core).** Base32 (RFC 4648, padding optional), strict
  `otpauth://totp/` URI parse (§15.1 bounds, unknown params ignored, failures
  refuse with a message), TOTP codegen (HMAC-SHA-1/256/512 via
  `javax.crypto.Mac`, RFC 4226 truncation, `T = floor(unix/period)`).
  Vectors: RFC 6238 appendix B (8 digits, all three digests) checked in; 6
  -digit vectors recomputed by a python3 `hmac` script stored with them
  (tools/vectors). `OtpTest.kt` covers every vector, bad URIs, base32 edge
  cases, and period boundaries.
- **Task 2 — the vault field.** `Entry.Login` gains `totp: String?`;
  `EntryJson` encodes `null` as absent and decodes strictly. One
  login-with-totp record added to `vault-vectors.json` (via `VectorGen`).
  `EntryJsonTest` and `VaultFormatTest` updated. Export CSV carries the URI
  (§8's format, own column) — confirm the exporter's column list first.
- **Task 3 — FormDetector otp role.** Ranked: `smsOTPCode`-style hint →
  `autocomplete="one-time-code"` (HtmlInfo) → bounded keyword heuristic
  (code/otp/verification/2FA/confirmation, English + Roman-Urdu; numeric
  input; 4–8 digits; maxlength 4–8). CVC and password fields never qualify.
  `FormDetectorTest` covers ranking, exclusions, and no-false-positive forms
  (card checkout, password signup).
- **Task 4 — TOTP fill datasets.** Unlocked only, matching logins only (§7
  rules), one dataset per login, presentation `123456 · name`, targets every
  otp field in the form; no SaveInfo. `Datasets.kt` + service wiring;
  `SavesTest`-style JVM tests for dataset shape; a service-level test that a
  locked vault offers nothing for an otp field.
- **Task 5 — SMS receiver.** Manifest receiver on `SMS_RECEIVED`;
  `SmsCodes.kt` (core, pure) does extraction and the 2-minute volatile
  cache; Urdu/English fixtures as JVM tests. Settings toggle → runtime
  permission; service offers the freshest cached code; delayed fill
  (`FLAG_DELAY_FILL`) wired and verified on the emulator (API 35/36) with a
  `sms send` script before any phone work. Nothing ever persisted; asserted
  in the receiver's code review and by `tools/disk-check.sh` staying silent
  after a send-receive round trip.
- **Task 6 — scan screen.** zxing-android-embedded (Apache-2.0, the only new
  dependency — run the upgrading-dependencies check), `CAMERA` at scan time,
  `FLAG_SECURE` screen, parsed-URI confirmation before save, wired into
  Add/Edit. Emulator loop claims `apps/strongroom` first.
- **Task 7 — Google Authenticator import.** Own protobuf reader for
  `otpauth-migration`, multi-batch scan ("3 of 4"), dedup, review list,
  HOTP skipped with a count, one transaction. First check a real export from
  the owner's phone (Step 0, like the Google CSV import). Migration-format
  vectors checked in.
- **Task 8 — screens and finish.** Entry screen live code (`123 456`,
  countdown, sensitive copy, remove); Settings entries; `disk-check.sh`
  gains the TOTP secret as a needle; whole-feature review (§12 gate 4);
  `pnpm test`, `pnpm typecheck`, Gradle gates green; handoff updated.

Done means (checked on the emulator, then the phone with the owner's word):
a scanned code fills into an app's otp field unlocked and shows nothing
locked; an SMS-sent code fills, including one that arrives after the field
is focused; a real Authenticator export imports with the right counts;
the on-disk check passes with a TOTP secret; every §15 claim verified.
