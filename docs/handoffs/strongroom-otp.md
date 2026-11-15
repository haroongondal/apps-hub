# Handoff: Strongroom OTP (authenticator codes and SMS code fill)

## Resume prompt

Dated 2026-11-15 (first two sessions, Tasks 1–2 committed). Implements
`docs/strongroom/DESIGN.md` §15 per `docs/strongroom/OTP-PLAN.md`. Work happens
in a worktree off `main` (226a947) on branch `strongroom-otp` — this pair of
sessions used `/Users/outsentia/.local/share/opencode/worktree/044235/strongroom-otp`;
any fresh worktree off the same branch is equivalent. The branch has three
commits: f2d7684 (DESIGN §15 + OTP plan), fb3a7fd (Task 1, `Otp.kt` + vectors),
7e1a1c0 (Task 2, the vault field, both languages). No upstream, never push,
merge or release without the owner's word.

Read first: `docs/strongroom/OTP-PLAN.md` (the task list — one task at a time,
committed and reviewed before the next), then `DESIGN.md` §15, then
`docs/handoffs/strongroom.md` (the app's background: phone facts, emulator,
Store rules). Bound rules: Kotlin owns all vault and OTP logic, RN renders
only; JVM tests via `:strongroom-vault:testDebugUnitTest`; `node --test` for
TS; `coord claim apps/strongroom` before any build-install-test loop; never
adb-install on the phone — Store releases only, with the owner's word; no
commit attribution lines; explicit `git add` pathspecs.

**Before Task 3:** the main checkout
(`/Users/outsentia/Documents/apps-hub`, branch `model-host`) had another
session's uncommitted password-generator iteration touching
`FormDetector.kt`, `Datasets.kt`, `StrongroomAutofillService.kt` and
`PasswordGenerator.kt` (a repeat-box `confirm` field in `FormDetector.kt`
plus its test). Local `main` (226a947) already carries the committed version;
this branch is off it. Task 3 edits `FormDetector.kt`: before starting, check
whether that iteration has landed on `main` and rebase over it; otherwise
expect a conflict in that one file when it does.

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
- **Task 3 next:** FormDetector otp role (hint → autocomplete → bounded
  keyword heuristic; CVC/password never qualify). Rebase risk above.
- **Tasks 4–8** per the plan: TOTP fill datasets (unlocked only, matching
  logins only, no SaveInfo) → SMS receiver (`SmsCodes.kt`, 2-minute volatile
  cache, nothing persisted) → zxing scan screen (only new dependency,
  Apache-2.0, run the upgrading-dependencies check) → GA migration import
  (owner's real export first, like the CSV import's step 0) → screens +
  `disk-check.sh` totp needle + whole-feature review.

## Gotchas learned the hard way

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

## Test commands

```bash
# Kotlin module suite (from apps/strongroom/android):
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
  ./gradlew :strongroom-vault:testDebugUnitTest
# JUnit XMLs: modules/strongroom-vault/android/build/test-results/testDebugUnitTest/
pnpm test && pnpm typecheck   # whole workspace; strongroom-core included
```
