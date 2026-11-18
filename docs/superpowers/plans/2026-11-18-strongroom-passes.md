# Strongroom passes (non-payment NFC and barcode cards): plan

Date: 2026-11-18. Status: draft, not started. Owner approval needed before any task runs.

## Goal

A fourth vault entry type, **pass**, for membership, loyalty, gym and similar cards that are not
bank cards. A pass is shown as a barcode or QR code, and can optionally be presented over NFC from
the phone. It lives in the same encrypted vault as logins, cards and notes.

## What this can and cannot do (fixed by Android, not by us)

- Android host card emulation (HCE) can answer a reader only as an ISO-DEP (ISO 14443-4) device. It
  cannot copy a physical card's hardware ID.
- **Cannot:** clone MIFARE Classic, MIFARE DESFire or 125 kHz fobs (most gyms and building doors),
  or pay (see the earlier answer: no issuer keys).
- **Can:** present an NDEF tag (a URL or text) to any phone or reader that reads NFC tags, and show
  a barcode or QR code to a scanner. The barcode half works with any system that accepts a scanned
  code; the NFC half only helps with readers that accept an NDEF tag.
- So the barcode half is the sure value. The NFC half is worth keeping only if the owner has a reader
  that takes it (open item 1).

## Decisions (my calls, correct any of them)

- One entry type `pass { name, code, format, note }`. `format` is one of `qr`, `code128`, `ean13`.
  Skipped on purpose: more formats, custom fields, images of the card.
- NFC presents the same `code`: as a URI record if it starts with `http://` or `https://`, otherwise
  as a text record. No custom AIDs (no known reader needs one).
- NFC is **armed on demand**: the owner opens a pass and taps "Hold to reader"; the service answers
  for 60 s (`elapsedRealtime`), then wipes the payload. Unarmed, the service answers "file not
  found". The service also sets `requireDeviceUnlock`, and the screen shows a Cancel.
- Barcode generation uses `com.google.zxing:core` (Apache-2.0, pure Java, no Play Services), so the
  F-Droid-pure rule holds. Audit it with the `upgrading-dependencies` skill before adding.
- Pass codes stay out of the autofill match index (same as cards) and are never filled by autofill.
- The code reaches JS only on Show and Present, like a card number. The barcode is drawn natively
  and returned as a PNG data URI, so the code is not re-encoded in JS.

## Non-goals

Payment cards or EMV; scanning or importing a physical NFC card; lock-screen or quick-tile access;
sync-server changes (the server stores ciphertext and never sees the type); iOS.

## File map

| Layer | File | Change |
|---|---|---|
| Model | `modules/strongroom-vault/android/.../core/Entry.kt` | add `Entry.Pass`, `EntryJson` encode and decode for `"pass"` |
| NFC protocol | `.../core/Ndef.kt`, `.../core/Type4Tag.kt` (new) | NDEF record encoder; Type 4 tag APDU state machine, pure Kotlin |
| Barcode | `.../android/PassImage.kt` (new) | zxing encode to PNG |
| Service | `.../android/StrongroomTagService.kt`, `res/xml/strongroom_tag_service.xml` (new), `AndroidManifest.xml` | `HostApduService`, AID `D2760000850101`, `android.permission.NFC`, `uses-feature android.hardware.nfc.hce` (not required) |
| Bridge | `StrongroomVaultModule.kt`, `android/EntryInput.kt`, `modules/strongroom-vault/src/index.ts` | pass in row mapping and input; `passImage(id, px)`, `presentPass(id)`, `stopPresenting()` |
| UI | `src/EditScreen.tsx`, `src/forms.ts`, `src/VaultScreen.tsx`, `src/EntryScreen.tsx`, `src/parts.tsx` | Pass kind and fields, Passes tab, barcode view, "Hold to reader" sheet |
| Docs | `docs/strongroom/DESIGN.md`, `docs/handoffs/strongroom.md` | entry type, the limits above, session log |

## Tasks

Run in order. Each task ends with its tests green before the next starts.

1. **Pass entry.** Add `Entry.Pass` and JSON round trip. Tests in `EntryJsonTest`: round trip,
   `toString` hides `code`, and what an older build does with an unknown `"pass"` type (read the
   decoder first; if it throws, make unknown types survive as opaque so a sync from a newer
   client cannot break an old one).
2. **NDEF and Type 4 tag, pure.** `Ndef.kt` encodes URI and text records. `Type4Tag.kt` handles
   SELECT AID, SELECT CC (`E103`), READ BINARY, SELECT NDEF (`E104`), READ BINARY in chunks, wrong AID
   and unarmed (both `6A82`). Tests drive it with a fake reader that does the full read sequence and
   decodes the record, plus the NFC Forum capability-container bytes as a fixed vector, a payload
   larger than one read, and an over-limit payload refused at arm time.
3. **Barcode.** Add zxing core (audit first). `PassImage.kt` returns a PNG for `qr`, `code128`,
   `ean13`. Tests: encode then decode with zxing's reader gives the same text; a bad EAN-13 length
   or non-digit is rejected with a message the UI can show.
4. **Bridge.** Wire pass through `StrongroomVaultModule`, `EntryInput`, `index.ts`. `presentPass`
   requires an unlocked vault and uses the same gate that Show uses for a card number (reuse, do
   not add a new prompt). Arm and wipe live in one small `Presenting` object with the 60 s clock.
5. **Service and manifest.** `StrongroomTagService` answers from `Type4Tag` only while armed;
   `setPreferredService` from the presenting activity so Google Wallet's NDEF handling does not win
   the AID. Add NFC permission and the optional HCE feature. `:app:assembleDebug` must pass.
6. **UI.** Pass kind in the editor (Name, Code, Format as `Segmented`, Note), Passes tab, entry view
   with the barcode at full width and screen brightness raised while it is open (restored on leave),
   and a "Hold to reader" sheet with a countdown and Cancel. Sentence case, `@apps-hub/ui` only.
   Add the pass cases to `src/__tests__/forms.test.ts` and confirm that file is listed in the
   package's `test` script.
7. **Docs.** DESIGN.md: new entry type, the HCE limits, the arming rule. Handoff: session log and
   next step.
8. **Gates.** `cd apps/strongroom/android && ./gradlew :strongroom-vault:testDebugUnitTest
   :app:assembleDebug`, `pnpm --filter strongroom test`, `pnpm --filter strongroom typecheck`, then
   `invariant-reviewer` and `code-reviewer` on the diff.

## Phone check (needs the owner)

Real phone only, no emulator. Install only through the Store, which means a Strongroom release, so
it waits for the owner's word (`pnpm release` is local and manual). Before testing: `coord claim
device:<ro.serialno>`. Checks:

- The barcode scans from another device's camera and from a real scanner at the gym or shop.
- With "Hold to reader" armed, a second NFC phone (or an NFC reader app) reads the URL or text.
- Unarmed, the second phone reads nothing; after 60 s it reads nothing.
- Locked phone: nothing is presented.

## Open items for the owner

1. **Which readers?** Name one reader that should accept the phone. If none, I'd ship tasks 1, 3, 4
   (barcode only) and skip 2 and 5, which drops the NFC code entirely.
2. **A second NFC device** to act as the reader during the phone check.
3. **Where to build.** Strongroom work has run in worktrees (Phase 1, sync, extension security), and
   sync touches the same `Entry.kt` and vault format. I did not check which branch is current or
   whether sync has merged, so pick the base branch before task 1.

## Risks

- Some phones' NFC chips or ROMs (HyperOS is the one on your phone) restrict HCE or ignore
  `setPreferredService`. Only the phone check can tell; the barcode half is unaffected.
- Adding zxing adds a dependency to a security app. It is pure Java with no network access, but it is
  still new code in the APK; the dependency audit in task 3 is not optional.
