# Inflow stage 3 (Gmail) Implementation Plan

> **For agentic workers:** execute with `cd-engineering-tools:parallel-agents-coord` (it replaces `superpowers:subagent-driven-development` in this repo, per `~/.claude/CLAUDE.md`). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Inflow signs in to the owner's Gmail with an app password, downloads the full text of emails from marked senders (the owner's two bank alert addresses by default), merges each email with its Gmail notification into one item, and reads the owner's two bank email formats into the ledger, counted once alongside the matching SMS.

**Architecture:** Same split as stages 1 and 2. Pure Kotlin in `core/` (email reading from raw MIME, HTML to text, bank email patterns, account resolution, email ingest and merge) tested on the JVM against the in-memory fakes; Android glue in `android/` (IMAP client, sync scheduling, schema v3, module functions); RN renders through the TS contract with `@apps-hub/ui`.

**Tech stack:** Kotlin, Eclipse Angus Mail 2.0.3 (`org.eclipse.angus:angus-mail`, Jakarta Mail 2.1 API; licence EPL-2.0 OR GPL-2.0 with Classpath Exception OR BSD-3-Clause (EDL 1.0); runs on Android unchanged since Jakarta Mail 2.0, min API 19; no SASL on Android, not needed), SQLCipher, Expo modules, React Native.

**Spec:** `docs/superpowers/specs/2026-11-13-inflow-design.md` (sections Gmail, Money, Renaming senders, "Calls I made", stage 3). Conventions: stage 2 plan `docs/superpowers/plans/2026-11-13-inflow-stage-2.md`. Handoff: `docs/handoffs/inflow.md`.

## Verified before planning

- Jakarta Mail 2.0+ standard distribution runs on Android (jakartaee.github.io/mail-api/Android). Inflow's minSdk is 33.
- Release builds do not minify (`android.enableMinifyInReleaseBuilds` unset, `app/build.gradle:69`), so Angus Mail's `META-INF` provider files survive; no ProGuard rules needed.
- Stages 1-2 strip INTERNET in `apps/inflow/android/app/src/release/AndroidManifest.xml`; nothing else (no test) enforces it. AGENTS.md line 51 says "no INTERNET permission until the AI stage": stage 3 changes that line.
- The ledger already has `Channel.EMAIL` and `Channel.EMAIL_NOTIFICATION`; `Ingest.onNotification` tags `com.google.android.gm` items `EMAIL_NOTIFICATION`. `LedgerStore.addChannel(itemId, channel)` (F2) appends a channel to the source row of an item.
- `InflowListener.executor` is the single capture thread; a long Gmail sync must not run on it.

## Owner's bank email samples (numbers changed by the owner; use verbatim as fixtures)

From `admin.ebanking@ubl.com.pk` (UBL Raast, money out):
```
Dear HAROON MUKHTAR ,

You paid PKR. 7,000.00 to JAYISHA NOOR via Raast.

Here are the details:

Account Title: HAROON MUKHTAR
Account Details: Pwd Colony Road Branch, Islamabad - 28*****33
Date: 23-Oct-2026
Time: 06:53:20 PM
Transaction ID: 1430551744
Transaction Type: Inter Bank Funds Transfer Raast
```

From `email.notification@bankalfalah.com` (Alfalah POS, money out; labels and values sit in separate table cells, shown here as the owner copied them):
```
Transaction Successful

Thursday, November 12, 2026 | 4:19 PM

Ref# FT263160G6MC4S12

Account Title

HAROON MUKHTAR

Account/IBAN

*****2310

Purpose of Payment

Others

Transaction Type

POS

Tax/Charges

PKR 0.0000/-

Orbits

-

Available Balance

Type 'AB' & send SMS to 8287

Amount

PKR 1,700.00/-

Get exclusive updates, exciting offers, and the latest features—right at your fingertips!
Join our WhatsApp Channel today and stay connected:

Join WhatsApp Channel
WhatsApp QR Code
For queries or assistance, please call/Whatsapp: 021111225111
```

## Global constraints (in addition to stages 1-2)

- New permission: `INTERNET` only, in the module manifest; the release overlay that strips it is deleted. Inflow connects to `imap.gmail.com:993` over TLS and nowhere else. Still no READ_CONTACTS, no QUERY_ALL_PACKAGES, no analytics.
- The app password is stored only in the SQLCipher database (meta `gmailPassword`), never logged, never sent to JS (the module returns the address, never the password). Never log email text, subjects or addresses.
- Original text is never changed: when an email merges into its notification item, the notification's `text` stays as captured and the email body goes in the new `email_text` column.
- Only marked senders are downloaded. OTP emails are never saved. Amounts are integers in minor units.
- One transaction is counted once; Dedup rules from stage 2 apply unchanged to the `EMAIL` channel.
- Every new `*.test.ts` goes in `apps/inflow/package.json`'s `test` script. Erasable TS only. Copy: sentence case, plain words, errors say what happened and what to do.

## Rulings (controller, before dispatch)

- R13: the "mark sender as bank" switch (deferred by R2) becomes a "Download emails from" list in Settings > Gmail, matched against the email's From header (IMAP FROM search: address or name substring), seeded with `admin.ebanking@ubl.com.pk` and `email.notification@bankalfalah.com` on first sign-in. Bank patterns keep running on every item (R2). Why: Gmail notifications carry only the display name, IMAP matches addresses exactly, and the owner gave the two addresses. Cost if wrong: marking is in Settings, not on the thread; easy to add a switch to the rename sheet later.
- R14: the app password lives in the SQLCipher meta table, whose key is wrapped by the Android Keystore; no second vault. Why: the design asks for Keystore-backed encryption and the database already is; Deputy's KeyVault handles several keys per provider, which Gmail does not need. Cost if wrong: one more meta row a future export must skip.
- R15: downloads search `[Gmail]/All Mail` (the folder with the `\All` attribute; fallback `INBOX`) so filtered bank emails that skip the inbox count. Full history per sender on first sync, like the SMS inbox. Cost: a slow first sync for a sender with thousands of emails (batched, background).
- R16: sync runs on its own single-thread executor (`GmailSync`), never on the capture thread: 10 s after any Gmail notification (coalesced), every 15 min while the process lives (started from `onListenerConnected`), and from Home via `syncGmail()`. No WorkManager. Cost if wrong: if HyperOS kills the process, email waits for the next Gmail notification or app open.
- R17: a UBL email shows only the account's last two digits (`28*****33`). The ledger resolves a partial account to the one known account of that bank ending in those digits (`UBL 1733`); with none or several it keeps `UBL 33`. Cost: a wrongly resolved account if the owner has two UBL accounts ending in the same two digits (then it stays partial, by the "exactly one" rule).
- R18: the Alfalah email parses only `Transaction Type POS` (money out); other types return null until the owner gives a sample (stage 4's AI reads them). Ref# is the transaction id.

## Review focus

1. **Email and its notification become one item** in either order (notification first, then sync; sync first, then notification), and a second sync never adds the email again. Pinned in K3.
2. **One transaction across SMS, notification and email**: the Alfalah card SMS, its Gmail notification and the POS email give one txn with channels {SMS, EMAIL} (+ EMAIL_NOTIFICATION if the snippet parsed). Pinned in K3.
3. **HTML table emails read as text with spaces between cells** (`<td>Amount</td><td>PKR 1,700.00/-</td>` must not become `AmountPKR`), entities decoded, style/script dropped. Pinned in K1.
4. **"Tax/Charges PKR 0.0000/-" is never the amount**; the amount is the one after the `Amount` label. Pinned in K1.
5. **A wrong app password or no network** leaves a plain error in Settings and never crashes or loops; the password never reaches JS or logs. Pinned in K4 (manual) and T2.

## Interfaces (shared by both agents; follow them exactly)

### Kotlin `core/`

```kotlin
// core/Bank.kt (changed)
data class Parsed(..., val txId: String?, val accountPartial: Boolean = false)  // partial: account = "<Bank> <fewer than 4 digits>"
object Accounts {
  /** R17: a partial account becomes the one known "<Bank> NNNN" ending in its digits; otherwise unchanged. */
  fun resolve(p: Parsed, known: List<String>): Parsed
}

// core/Email.kt (new)
data class RawEmail(
  val messageId: String?, val fromName: String?, val fromAddress: String,
  val subject: String, val text: String,   // text: plain text of the body (HTML part preferred, converted by HtmlText)
  val at: Long,                             // IMAP INTERNALDATE (arrival at Gmail), epoch ms
)
object HtmlText { fun toPlain(html: String): String }
object Email {
  const val GMAIL = "com.google.android.gm"
  /** Null when the bytes are not a readable message or have no text body. */
  fun read(raw: ByteArray, at: Long): RawEmail?           // uses jakarta.mail MimeMessage; no Android APIs
  fun hash(e: RawEmail): String                            // SHA-256 hex of "email\u0000${messageId ?: "$fromAddress\u0000$at\u0000$subject"}"
  fun capture(e: RawEmail, label: String): Capture
  // pkg = GMAIL, appLabel = label, sender = fromName ?: fromAddress, senderKey = senderKey(GMAIL, sender),
  // conversation = null, conversationKey = null, title = subject, text = e.text, postedAt = at, hash = hash(e), deletedPlaceholder = false
}

// core/Ledger.kt (changed)
interface LedgerStore { ...; fun accounts(): List<String>; fun setCounterpartyIfNull(id: Long, counterparty: String) }
// Ledger.onItem: after parse, p = Accounts.resolve(p, store.accounts()); on a merge also setCounterpartyIfNull when the txn has none.

// core/ItemStore.kt (changed)
interface ItemStore {
  fun insert(c: Capture, search: String, otpExpiresAt: Long?, smsHash: String? = null, emailHash: String? = null): Long?
  fun hasEmailHash(emailHash: String): Boolean
  /** Newest Gmail item with email_hash null, posted within ±window, whose text starts with subject (subject non-blank). */
  fun emailTwin(subject: String, at: Long, windowMs: Long): Long?
  /** A Gmail item with email_hash set, posted within ±window, whose non-blank title the given notification text starts with. */
  fun emailItemNear(text: String, at: Long, windowMs: Long): Boolean
  /** Sets email_hash and email_text on a notification item and adds the email text to its search column. */
  fun claimEmail(itemId: Long, emailHash: String, emailText: String, search: String)
}

// core/Ingest.kt (changed)
fun onEmail(e: RawEmail, label: String): Int   // 1 when a new item was saved or a notification item gained its email, else 0
```

`Ingest.onEmail`: Gmail app setting (default on first sight, `Retention.default(GMAIL, label)`); `record == false` → 0. `h = Email.hash(e)`; `hasEmailHash(h)` or `isTombstoned(h)` → 0. `isOtp(GMAIL, e.text)` (the stage 2 rule: OtpDetector and not a bank pattern) → 0, nothing saved. `twin = emailTwin(e.subject, e.at, Dedup.MERGE_WINDOW_MS)`: if found, `claimEmail(twin, h, e.text, search)`, then `ledger?.onItem(twin, e.text, Channel.EMAIL, e.at) ?: ledger?.addChannel(twin, Channel.EMAIL)`, return 1. Else `insert(Email.capture(e, label), search, null, emailHash = h)`, `ledger?.onItem(id, e.text, Channel.EMAIL, e.at)`, `housekeeping()`, return 1.

`Ingest.onNotification` change: for a capture with `pkg == Email.GMAIL`, skip it when `emailItemNear(c.text, c.postedAt, Dedup.MERGE_WINDOW_MS)` (the email already saved owns this message).

`BankParser` additions (same flags; amounts accept `PKR`, `PKR.`, any whitespace):
- UBL Raast out email: `You paid PKR. <amt> to <name> via Raast.` + `Account Details: … - <digits/stars>` + `Transaction ID: <digits>` → OUT, account `"UBL " + trailing digits after the last '*'` (`"UBL 33"`, `accountPartial = true` when fewer than 4 digits), counterparty `<name>` (`"JAYISHA NOOR"`), txId the digits.
- Alfalah POS email: `Account/IBAN <stars>NNNN`, `Transaction Type POS`, `Amount PKR <amt>/-`, `Ref# <alnum>` → OUT, `"Alfalah NNNN"`, counterparty null, txId the Ref.
- The stage 2 SMS patterns are unchanged and still match first.

`HtmlText.toPlain`: drop `<head>`, `<style>`, `<script>` with their content and HTML comments; `<br>`, and closing `</p> </div> </tr> </td> </th> </li> </h1-6> </table>` become a newline; every other tag becomes a space; decode `&nbsp; &amp; &lt; &gt; &quot; &#39; &#NNN; &#xHH;`; collapse runs of spaces and tabs to one space per line, trim lines, collapse 3+ newlines to 2, trim.

### SQL schema v3 (migration from v2 in `ensureSchema`; a fresh install runs v1, v2, v3)

```sql
ALTER TABLE items ADD COLUMN email_hash TEXT;
ALTER TABLE items ADD COLUMN email_text TEXT;
CREATE UNIQUE INDEX items_email ON items(email_hash) WHERE email_hash IS NOT NULL;
CREATE TABLE gmail_senders(query TEXT PRIMARY KEY, uid_validity INTEGER, last_uid INTEGER NOT NULL DEFAULT 0);
```

### TS contract additions (`modules/inflow-core/src/index.ts`)

```ts
export interface Item { /* stage 1-2 fields */ emailText: string | null }   // the full email when it merged into this notification
export interface GmailStatus { address: string | null; lastSyncAt: number | null; error: string | null; senders: string[] }
// added to InflowCoreApi:
//   gmailStatus(): GmailStatus
//   connectGmail(address: string, appPassword: string): Promise<{ ok: boolean; message: string | null }>   tests the sign-in, then saves; seeds senders when the list is empty; starts a sync
//   disconnectGmail(): void                     forgets address and password; keeps senders and saved emails
//   addGmailSender(query: string): void         trimmed, lowercased; blank ignored
//   removeGmailSender(query: string): void      keeps emails already saved
//   syncGmail(): Promise<{ imported: number }>  sends onCaptured when it imported anything
```

Error copy (Kotlin returns these exact strings; T shows them as given):
- `"Gmail refused the sign-in. Check the address, make a new app password and try again."` (authentication failed)
- `"Inflow could not reach Gmail. It will try again in a few minutes."` (network or server error)
- `"Enter your Gmail address."` / `"An app password has 16 letters. Copy it again from your Google account."` (validation; T checks first, Kotlin again)

---

## Agent K: Kotlin (one implementer, tasks in order, one commit each)

Gradle from `apps/inflow/android` with `JAVA_HOME` and `ANDROID_HOME` exported: `./gradlew :inflow-core:testDebugUnitTest`; gate `./gradlew :inflow-core:testDebugUnitTest :app:assembleDebug`.

### K1: Email text and bank email patterns

**Files:** modify `core/Bank.kt`; create `core/HtmlText.kt`; tests `core/BankParserTest.kt`, new `core/HtmlTextTest.kt`.

- [ ] Tests first:
  - `ublRaastOutEmail`: the UBL sample verbatim → `Parsed(OUT, 700000, "PKR", "UBL 33", "JAYISHA NOOR", "1430551744", accountPartial = true)`.
  - `alfalahPosEmail`: the Alfalah sample verbatim → `Parsed(OUT, 170000, "PKR", "Alfalah 2310", null, "FT263160G6MC4S12")`; the same text with the label/value lines joined by single spaces (as `HtmlText` produces) parses the same.
  - `alfalahNonPosEmailIsNull`: the sample with `POS` replaced by `IBFT` → null. `taxLineIsNotAmount`: the sample with the `Amount` block removed → null.
  - Stage 2 SMS tests stay green.
  - `HtmlTextTest`: `<tr><td>Amount</td><td>PKR&nbsp;1,700.00/-</td></tr>` → `"Amount\nPKR 1,700.00/-"`; `<style>p{}</style><p>a<br>b</p>` → `"a\nb"`; `&amp;&#39;&#x41;` → `"&'A"`; nested inline tags `<b>PKR</b> <span>5</span>` keep the space.
- [ ] Red, implement, green. Commit `Inflow: bank email patterns and HTML text`.

### K2: Reading raw email, partial accounts, counterparty fill

**Files:** modify `modules/inflow-core/android/build.gradle` (add `implementation("org.eclipse.angus:angus-mail:2.0.3")` with a one-line licence comment like the SQLCipher one; it brings `jakarta.mail-api` and `angus-activation`); create `core/Email.kt`; modify `core/Bank.kt` (`Accounts`), `core/Ledger.kt`; tests `core/EmailTest.kt` with fixtures in `src/test/resources/email/` (`ubl.eml`: single-part text/html, quoted-printable, the UBL sample in `<p>`/`<br>` markup; `alfalah.eml`: multipart/alternative with a short text/plain part and an HTML table part holding the Alfalah sample one label/value pair per row, base64; `From: "UBL Digital" <admin.ebanking@ubl.com.pk>`, RFC 2047 encoded subject in one of them), `LedgerTest.kt`, `MemoryLedgerStore.kt`.

- [ ] Tests first:
  - `readsHtmlEmail` / `readsMultipartPrefersHtml`: `Email.read(bytes, at)` gives fromName, fromAddress, decoded subject, `messageId`, and `text` that `BankParser.parse` reads to the K1 values.
  - `unreadableIsNull`: random bytes or a message with only an attachment → null.
  - `hashUsesMessageIdElseFields`.
  - `partialAccountResolves` (`Accounts.resolve` with known `["UBL 1733", "Alfalah 2310"]` → `"UBL 1733"`, `accountPartial = false`); `partialAccountAmbiguousStays` (`["UBL 1733", "UBL 9933"]` → unchanged); `fullAccountUntouched`.
  - Ledger: `emailMergesWithSmsByWindow` (Alfalah debit SMS for PKR 1,700.00 at t0, Alfalah POS email text at t0 + 4 min → one txn, channels {SMS, EMAIL}, txId `FT263160G6MC4S12`); `emailFillsMissingCounterparty` (email first then SMS: counterparty becomes the SMS merchant); `ublEmailResolvesToKnownAccount` (UBL incoming SMS for `*1733` exists, then the UBL out email → txn account `"UBL 1733"`).
- [ ] Red, implement, green. Commit `Inflow: read emails, resolve partial accounts`.

### K3: Email ingest and merge with the Gmail notification

**Files:** modify `core/ItemStore.kt`, `core/Ingest.kt`, `android/SqlItemStore.kt` (schema v3 and the new `ItemStore` methods, so every commit compiles; K4 adds only sender rows and cursors), test `core/MemoryItemStore.kt`, new `core/EmailIngestTest.kt`.

- [ ] Tests first (`EmailIngestTest`, Gmail notification built as in `IngestTest` with `pkg = "com.google.android.gm"`, title = sender name, bigText = `"$subject\n$snippet"`):
  - `notificationThenEmailIsOneItem`: notification, then `onEmail` with that subject 1 min later → 1 item, `emailText` set on it, its `text` unchanged; a second `onEmail` of the same email → 0.
  - `emailThenNotificationIsOneItem`: `onEmail` first, then the notification → `onNotification` returns 0, 1 item.
  - `differentSubjectStaysTwo` and `outsideWindowStaysTwo` (11 min).
  - `otpEmailNeverSaved`: `"Your OTP is 482913. Do not share it."` → 0, no item.
  - `recordOffSkipsEmail`.
  - `smsNotificationAndEmailOneTxn`: Alfalah card SMS for PKR 1,700.00 via `onSms`, the Gmail notification (snippet without the amount), the POS email 3 min later → 2 items (SMS item, Gmail item with email text), 1 txn, channels {SMS, EMAIL}.
  - `claimedTwinWithTxnGainsEmailChannel`: Gmail notification whose text is itself a full bank pattern (makes a txn as EMAIL_NOTIFICATION), then its email → still 1 txn, channels {EMAIL_NOTIFICATION, EMAIL}.
- [ ] Red, implement, green (SqlItemStore gets the v3 migration and the new methods: `emailTwin` uses `substr(text, 1, length(?)) = ?`; `emailItemNear` uses `substr(?, 1, length(title)) = title AND title <> ''`; `claimEmail` updates `search = search || ' ' || ?`; `toItem` returns `emailText`). Commit `Inflow: email ingest and merge with notifications`.

### K4: Gmail sign-in, sync, schedule, module API

**Files:** create `android/GmailClient.kt`, `android/GmailSync.kt`; modify `android/InflowListener.kt`, `InflowCoreModule.kt`, `android/SqlItemStore.kt` (sender rows, cursors), module `AndroidManifest.xml` (add `INTERNET`), delete `apps/inflow/android/app/src/release/AndroidManifest.xml`, update the comment in `apps/inflow/android/app/src/main/AndroidManifest.xml`.

- [ ] `GmailClient`: `imaps` to `imap.gmail.com:993`, `mail.imaps.ssl.checkserveridentity=true`, `mail.imaps.connectiontimeout=20000`, `mail.imaps.timeout=60000`. `check(address, password)`: connect and close. `open()`: the folder with attribute `\All` from `list("*")`, else `INBOX`, read-only. Password: all whitespace removed before use.
- [ ] `GmailSync.sync(context): Int`: returns 0 at once when no credentials or a sync is already running (`AtomicBoolean`). Per `gmail_senders` row: reset `last_uid` to 0 when `uid_validity` differs; `search(FromStringTerm(query))`, fetch UIDs in one `FetchProfile`, keep UID > `last_uid`, ascending, batches of 20; skip messages over 2 MB (cursor still advances); `Email.read(rawBytes, internalDate)`; each batch in one `store.inTransaction` with `ingest.onEmail(e, "Gmail")` and the cursor update. Meta `gmailLastSyncAt` on success, `gmailError` set to the auth or network copy above and cleared on success. `AuthenticationFailedException` → auth copy; other `MessagingException`/`IOException` → network copy. Logs only exception class names.
- [ ] Scheduling (R16): `GmailSync.executor` (single thread, daemon). `schedule(ctx, delayMs)` coalesces (one pending at most). `InflowListener.capture`: after a Gmail notification is handled, `GmailSync.schedule(ctx, 10_000)`. `onListenerConnected`: start a 15 min fixed-delay sync once per process.
- [ ] Module: the six functions in the TS contract; `connectGmail` validates (address has `@`, password is 16 letters after removing whitespace), runs `check` off the JS thread, on success saves meta `gmailAddress`/`gmailPassword`, seeds the two R13 senders when `gmail_senders` is empty, clears `gmailError`, schedules a sync now; `syncGmail` runs the sync and sends `onCaptured` when it imported anything. `getStatus` unchanged. `listItems`/`getItem` return `emailText`.
- [ ] Gate green. Merged release manifest has INTERNET and still no QUERY_ALL_PACKAGES or READ_CONTACTS (`aapt2 dump badging` on the release APK or the merged manifest). Commit `Inflow: Gmail sign-in, sync and module API`.

## Agent T: TypeScript (one implementer, in parallel with K; never runs Gradle)

### T1: Contract and Gmail form helpers

**Files:** `modules/inflow-core/src/index.ts`; create `src/gmail.ts`, `src/__tests__/gmail.test.ts`; add it to `apps/inflow/package.json` `test`.

- [ ] Contract additions above.
- [ ] `src/gmail.ts`: `cleanAppPassword(s: string): string` (all whitespace removed); `gmailFormError(address: string, password: string): string | null` (the two validation strings above, address first); `syncLabel(lastSyncAt: number | null, now: number): string` (`"Not checked yet"`, else `"Checked " + whenLabel`-style text reusing `format.ts`).
- [ ] Tests: `"abcd efgh ijkl mnop"` → 16 letters, valid; 15 letters → the app password copy; blank address → the address copy; `syncLabel(null)`.
- [ ] Commit `Inflow: Gmail contract and form helpers`.

### T2: Screens

**Files:** `src/SettingsScreen.tsx` (new Gmail group or a `src/GmailSettings.tsx` it renders), `src/ItemSheet.tsx`, `src/HomeScreen.tsx`.

- [ ] Settings > "Gmail" group. Not connected: `Field` "Gmail address", `Field` "App password" (secure), helper text: "Inflow reads emails only from the senders below. It needs an app password: turn on 2-Step Verification in your Google account, open myaccount.google.com/apppasswords, make one for Inflow and paste it here." Button "Connect" (busy while the promise runs; shows `gmailFormError` or the returned message in a danger `Notice`). Connected: row with the address and `syncLabel`, the error (if any) as a danger `Notice`, buttons "Check now" (`syncGmail`) and "Disconnect". Always: "Download emails from" rows (remove action each) and a `Field` to add one (hint "An email address or a name, as it appears in the From line."). Footer: "The password stays in Inflow's encrypted history on this phone. Inflow connects only to Gmail."
- [ ] ItemSheet: when `item.emailText` is set, a "Full email" `Group` with the text, selectable, below the notification text.
- [ ] Home: call `syncGmail()` next to `importSms()` on mount and pull, when `gmailStatus().address` is set; errors ignored in UI (Settings shows them); `onCaptured` reloads Home.
- [ ] `pnpm --filter inflow typecheck` and `pnpm --filter inflow test` green. Commit `Inflow: Gmail settings, full email, sync on Home`.

## Controller: close

- [ ] After K and T commit: Gradle gate, `pnpm test`, `pnpm typecheck` from the worktree root; `git show --stat` per commit for ownership; diff the module's function names against the TS contract.
- [ ] Update AGENTS.md's Inflow entry (INTERNET now present, Gmail only).
- [ ] One whole-branch review on the most capable model over `inflow/stage-2..inflow/stage-3`, focused on the review-focus list, the password handling and the merge paths; `invariant-reviewer` in parallel (new dependency licence, INTERNET, logs, backup rules). One fix agent, one scoped re-review if the fix touches ingest, ledger, SQL or credentials.
- [ ] Update the handoff and commit `Inflow stage 3: handoff`.
- [ ] Phone check (owner present, after the release go; `device:<serial>` claimed; Store install only): connect with a real app password; the two bank senders' history downloads; a new bank email and its Gmail notification give one item with the full email; the matching SMS and email give one transaction; a wrong password shows the auth copy; airplane mode shows the network copy and the next sync recovers.
