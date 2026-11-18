# Inflow stage 2 (SMS and money) Implementation Plan

> **For agentic workers:** execute with `cd-engineering-tools:parallel-agents-coord` (it replaces `superpowers:subagent-driven-development` in this repo, per `~/.claude/CLAUDE.md`). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Inflow imports the SMS inbox and keeps up with new SMS, merges each SMS with its messaging-app notification into one item, reads the owner's three bank formats into a ledger that counts each transaction once, marks own transfers, and shows it all in a Money tab and the Home money block.

**Architecture:** Same as stage 1. Pure Kotlin in `core/` (bank parser, ledger and de-duplication, SMS ingest) tested on the JVM against in-memory fakes; Android glue in `android/` (SQLCipher schema v2, inbox importer, `SMS_RECEIVED` receiver, module functions); RN renders through the TS contract with `@apps-hub/ui`.

**Spec:** `docs/superpowers/specs/2026-11-13-inflow-design.md` (sections SMS, Money, "Calls I made", stage 2). Stage 1 plan for conventions: `docs/superpowers/plans/2026-11-13-inflow-stage-1.md`. Handoff: `docs/handoffs/inflow.md`.

## Verified before planning

- The Store installs with a `PackageInstaller` session and never calls `setWhitelistedRestrictedPermissions` (`apps/store/modules/store-installer/.../Installer.kt:88`). AOSP (android14-release `PackageInstaller.java`): `SessionParams.installFlags` defaults to `INSTALL_ALL_WHITELIST_RESTRICTED_PERMISSIONS`, and the javadoc says "By default all restricted permissions are allowlisted". `PackageInstallerService.createSessionInternal` (android14) no longer strips that flag. So READ_SMS and RECEIVE_SMS are allowlisted for Store installs; **no Store change is planned**. Remaining risk: Android 13+/15 "restricted settings" may need "Allow restricted settings" in App info first, the same path setup already explains for notification access. The phone check confirms it.

## Global constraints (in addition to stage 1's)

- New permissions: `READ_SMS`, `RECEIVE_SMS` only. Still no `INTERNET` in the release manifest, no READ_CONTACTS (contact names are a later stage).
- Original SMS text is stored byte for byte. Amounts are integers in minor units (paisa); never floats.
- One transaction is counted once. Two items from the same channel never merge. Own transfers are left out of every total. Totals are per account and currency, never converted.
- OTP rules hold for SMS: an OTP from the inbox that is already past its 5 minutes is never imported; a purged OTP's text is tombstoned so a later inbox sync can't bring it back; an OTP is never a transaction.
- Transactions survive their source items' retention purge.
- Every new `*.test.ts` goes in `apps/inflow/package.json`'s `test` script. Erasable TS only.

## Review focus

1. **Double counting.** An SMS and its notification, or an SMS seen by both the receiver and the inbox sync, must give one item and one transaction. Pinned in K2 and K3.
2. **Two real identical charges** (two PKR 1,500.00 at one shop within minutes, both by SMS) must stay two. Pinned in K2 (`sameChannelNeverMerges`).
3. **Own transfers** out of totals, and the owner's override wins over automatic pairing. Pinned in K2.
4. **OTP resurrection** through the inbox sync. Pinned in K3.
5. **Large inbox import** (thousands of SMS) must not block the JS thread or hold one giant transaction. K4 batches 500 per transaction on a background thread.

## Interfaces (shared by both agents; follow them exactly)

### Kotlin `core/`

```kotlin
// core/Bank.kt
enum class Direction { IN, OUT }
data class Parsed(
  val direction: Direction, val amountMinor: Long, val currency: String,
  val account: String,          // "Alfalah 2310", "UBL 1733": bank name + last 4 digits
  val counterparty: String?,    // raw text as the bank wrote it; cleaning is stage 4 (AI)
  val txId: String?,
)
object BankParser { fun parse(text: String): Parsed? }

// core/Ledger.kt
enum class Channel { SMS, SMS_NOTIFICATION, NOTIFICATION, EMAIL_NOTIFICATION, EMAIL }
data class Txn(
  val id: Long, val direction: Direction, val amountMinor: Long, val currency: String, val account: String,
  val counterparty: String?, val txId: String?, val at: Long,
  val own: Boolean, val ownSet: Boolean,   // ownSet = the owner chose `own` by hand; automation never changes it again
  val pairId: Long?, val channels: Set<Channel>,
)
interface LedgerStore {
  fun near(direction: Direction, amountMinor: Long, currency: String, from: Long, to: Long): List<Txn>
  fun byTxId(txId: String): Txn?
  fun get(id: Long): Txn?
  fun hasSource(itemId: Long): Boolean
  fun add(p: Parsed, at: Long, own: Boolean): Long
  fun addSource(txnId: Long, itemId: Long, channel: Channel, txId: String?, at: Long)
  fun setOwn(id: Long, own: Boolean, ownSet: Boolean, pairId: Long?)
  fun setTxIdIfNull(id: Long, txId: String)
}
object Dedup {
  const val MERGE_WINDOW_MS = 10 * 60_000L
  /** Pure decision: id of the transaction this source belongs to, or null for a new one. */
  fun match(p: Parsed, channel: Channel, at: Long, candidates: List<Txn>, byTxId: Txn?): Long?
}
object OwnTransfer {
  const val PAIR_WINDOW_MS = 30 * 60_000L
  fun nameMatches(counterparty: String?, ownerName: String?): Boolean
}
class Ledger(private val store: LedgerStore, private val ownerName: () -> String?) {
  /** Parses the item's text; returns the transaction id it was added to, or null when it is not a transaction. */
  fun onItem(itemId: Long, text: String, channel: Channel, at: Long): Long?
  /** The owner's choice; false also unlinks a pair (both sides become ownSet=true, own=false). */
  fun setOwnTransfer(txnId: Long, own: Boolean)
}

// core/Sms.kt
data class RawSms(val address: String, val body: String, val sentAt: Long, val receivedAt: Long)  // sentAt = provider date_sent = PDU timestamp
object Sms {
  val KNOWN_APPS: Set<String>   // com.google.android.apps.messaging, com.android.mms, com.samsung.android.messaging
  fun hash(senderKey: String, sentAt: Long, body: String): String   // SHA-256 hex of "sms\u0000$senderKey\u0000$sentAt\u0000$body"
  fun textHash(text: String): String                                 // SHA-256 hex of "text\u0000${text.trim()}"; tombstone for purged OTPs
  fun capture(sms: RawSms, smsPkg: String, smsLabel: String): Capture
  // sender = address; senderKey = senderKey(smsPkg, address); conversation = address; conversationKey = senderKey;
  // title = null; text = body unchanged; postedAt = receivedAt (sentAt when receivedAt is 0); hash = hash(senderKey, sentAt, body)
}
```

Rules `Dedup.match` must follow (in order):
1. If `p.txId != null` and `byTxId != null` → `byTxId.id` (any time gap, any channel).
2. Otherwise a candidate matches when: same direction, amount, currency and account; `|at - candidate.at| <= MERGE_WINDOW_MS`; `channel !in candidate.channels`; and not (`p.txId != null && candidate.txId != null && p.txId != candidate.txId`). Pick the candidate closest in time; ties → lower id.
3. Else null.

`Ledger.onItem`: return null if `store.hasSource(itemId)` or `BankParser.parse(text) == null`. Find candidates with `store.near(direction, amount, currency, at - MERGE_WINDOW_MS, at + MERGE_WINDOW_MS)`. On a match: `addSource`, and `setTxIdIfNull` when the new source has one. On no match: `add(p, at, own = OwnTransfer.nameMatches(p.counterparty, ownerName()))`, `addSource`, then try pairing: the opposite direction, same amount and currency, a **different** account, `|Δat| <= PAIR_WINDOW_MS`, `pairId == null`, `ownSet == false`; pick the closest. Mark both `own = true, ownSet = false, pairId = <the lower id>`. A transaction keeps the earliest source's time (`add` uses the first source's `at`).

`OwnTransfer.nameMatches`: both sides uppercased (Locale.ROOT), everything but letters and spaces dropped, whitespace collapsed, trimmed; true when equal and non-blank. `"HAROON MUKHTAR*"` matches `"Haroon  Mukhtar"`.

`BankParser` (case-insensitive, any whitespace including newlines between words, amounts with or without commas and decimals):
- Alfalah credit: `PKR <amt> Credited to your A/C: <xxxx-x***NNNN>` → IN, account `"Alfalah NNNN"`, no counterparty, no txId.
- Alfalah debit card: `Debit Card against A/C: <…NNNN> is charged for PKR <amt> on <date> at <time> at <merchant>.` → OUT, account `"Alfalah NNNN"`, counterparty = `<merchant>` trimmed with the final `.` removed (`"SHAAFI INTERNATIONAL HOSPIslamabad PK"`).
- UBL Raast: `PKR <amt> received from <name> in your UBL A/C *NNNN … Tx ID <digits>` → IN, account `"UBL NNNN"`, counterparty `<name>` as written (`"HAROON MUKHTAR*"`), txId the digits.
- Anything else → null (the Jazz sample, OTPs naming an amount, promotions).

### Kotlin store changes

```kotlin
interface ItemStore {
  // changed: returns the new row id, null when the hash or SMS hash is already saved or tombstoned
  fun insert(c: Capture, search: String, otpExpiresAt: Long?, smsHash: String? = null): Long?
  // new
  fun isTombstoned(hash: String): Boolean
  fun hasSmsHash(smsHash: String): Boolean
  /** A visible item from the SMS channel (sms_hash set) with exactly this text, posted within ±window. */
  fun smsItemNear(text: String, at: Long, windowMs: Long): Boolean
  /** Newest visible notification item (sms_hash null) from one of pkgs with exactly this text within ±window. */
  fun notificationTwin(text: String, at: Long, windowMs: Long, pkgs: Set<String>): Long?
  fun setSmsHash(itemId: Long, smsHash: String)
  // purgeExpiredOtps now also tombstones Sms.textHash(text) of each purged row
}
class Ingest(store, ownPkg, now, onOtpSaved = {}, ledger: Ledger? = null, smsPackages: Set<String> = Sms.KNOWN_APPS) {
  fun onSms(sms: RawSms, smsPkg: String, smsLabel: String): Int   // 0 or 1
}
```

`Ingest.onSms`: app setting for `smsPkg` (default on first sight); `record == false` → 0. `c = Sms.capture(...)`. Return 0 when `hasSmsHash(c.hash)`, `isTombstoned(c.hash)` or `isTombstoned(Sms.textHash(body))`. When `OtpDetector.isOtp(smsPkg, body)` and `c.postedAt + OTP_TTL_MS <= now()` → 0. When `notificationTwin(body, c.postedAt, Dedup.MERGE_WINDOW_MS, smsPackages)` finds an item → `setSmsHash(it, c.hash)`, return 0 (that item already went to the ledger). Otherwise insert with `smsHash = c.hash`, OTP expiry as in `onNotification`, `onOtpSaved`, ledger `onItem(id, body, Channel.SMS, c.postedAt)` unless OTP, then `housekeeping()`, return 1.

`Ingest.onNotification` change: for a capture whose `pkg in smsPackages`, skip it when `smsItemNear(text, postedAt, MERGE_WINDOW_MS)`. After a successful insert of a non-OTP capture, call `ledger?.onItem(id, text, channel, postedAt)` with channel `SMS_NOTIFICATION` for SMS apps, `EMAIL_NOTIFICATION` for `com.google.android.gm`, else `NOTIFICATION`.

### SQL schema v2 (migration from v1 in `ensureSchema`; a fresh install runs v1 then v2)

```sql
ALTER TABLE items ADD COLUMN sms_hash TEXT;
CREATE UNIQUE INDEX items_sms ON items(sms_hash) WHERE sms_hash IS NOT NULL;
CREATE TABLE txns(id INTEGER PRIMARY KEY, direction TEXT NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL,
  account TEXT NOT NULL, counterparty TEXT, tx_id TEXT, at INTEGER NOT NULL,
  own INTEGER NOT NULL DEFAULT 0, own_set INTEGER NOT NULL DEFAULT 0, pair_id INTEGER);
CREATE INDEX txns_at ON txns(at DESC, id DESC);
CREATE INDEX txns_match ON txns(amount_minor, at);
CREATE INDEX txns_txid ON txns(tx_id) WHERE tx_id IS NOT NULL;
CREATE TABLE txn_sources(txn_id INTEGER NOT NULL, item_id INTEGER NOT NULL UNIQUE, channel TEXT NOT NULL, tx_id TEXT, at INTEGER NOT NULL);
CREATE INDEX txn_sources_txn ON txn_sources(txn_id);
```
`item_id` has no foreign key on purpose: retention deletes items, transactions stay.

### TS contract additions (`modules/inflow-core/src/index.ts`)

```ts
export interface Status { /* stage 1 fields */ smsGranted: boolean }   // READ_SMS and RECEIVE_SMS both granted
export interface Txn {
  id: number; direction: 'in' | 'out'; amount: number /* minor units */; currency: string; account: string;
  counterparty: string | null; txId: string | null; at: number; own: boolean; paired: boolean; itemIds: number[];
}
export interface AccountTotal { account: string; currency: string; moneyIn: number; moneyOut: number; count: number }
export interface MerchantTotal { counterparty: string; currency: string; total: number; count: number }  // money out only, top 10
export interface MoneySummary { accounts: AccountTotal[]; merchants: MerchantTotal[] }  // own transfers left out
// added to InflowCoreApi:
//   importSms(): Promise<{ imported: number }>          inbox rows with _id > meta lastSmsId; first call imports everything
//   money(from: number, to: number): MoneySummary        at >= from AND at < to
//   listTxns(account: string | null, before: number | null, limit: number, beforeId: number | null): Txn[]   newest first, same paging as listItems
//   setOwnTransfer(txnId: number, own: boolean): void
//   getItem(id: number): Item | null                       null when retention removed it
//   getOwnerName(): string | null
//   setOwnerName(name: string | null): void                blank or null clears it
```

---

## Agent K: Kotlin (one implementer, tasks in order, one commit each)

Gradle commands from `apps/inflow/android` with `JAVA_HOME` exported: `./gradlew :inflow-core:testDebugUnitTest`, gate `./gradlew :inflow-core:testDebugUnitTest :app:assembleDebug`.

### K1: Bank parser
- [ ] Tests first, `core/BankParserTest.kt`: the three owner samples from the spec verbatim give exactly: Alfalah credit IN 59324901 PKR "Alfalah 2310" null null; Alfalah debit OUT 150000 PKR "Alfalah 2310" "SHAAFI INTERNATIONAL HOSPIslamabad PK" null; UBL IN 5000000 PKR "UBL 1733" "HAROON MUKHTAR*" "7224343340". The Jazz sample, `"OTP 123456 for PKR 25,000 at Daraz"` and `"Get PKR 500 cashback on your next order"` give null. A variant with `\r\n` line breaks and doubled spaces parses the same.
- [ ] Red, implement `core/Bank.kt`, green. Commit `Inflow: bank SMS parser`.

### K2: Ledger, de-duplication, own transfers
- [ ] Write `core/MemoryLedgerStore.kt` (test source set) and `core/LedgerTest.kt`:
  - `smsAndNotificationMerge`: the same debit text as `SMS_NOTIFICATION` then `SMS` 2 min apart → one txn with two channels.
  - `sameChannelNeverMerges`: two identical debit texts, both `SMS`, 1 min apart, different item ids → two txns.
  - `outsideWindowNoMerge`: 11 min apart, different channels → two txns.
  - `txIdMergesAcrossDays` and `differentTxIdsNeverMerge`.
  - `ownByName`: owner name "Haroon Mukhtar" and the UBL sample → `own == true`.
  - `pairsOwnTransfer`: OUT PKR 50,000 from "Alfalah 2310" (synthesised debit text built from the card format with a 50,000 amount is fine, or build `Parsed` through a test-only path) and the UBL IN 50,000 20 min later → both own, same pairId. 31 min → not paired. Same account → not paired.
  - `ownerOverrideWins`: `setOwnTransfer(id, false)` on a paired txn → both sides own=false, ownSet=true, pairId null; a new matching txn does not re-pair them.
  - `sameItemOnce`: `onItem` twice with one item id → second returns null and adds nothing.
- [ ] Red, implement `core/Ledger.kt`, green. Commit `Inflow: ledger, de-duplication, own transfers`.

### K3: SMS ingest and merge
- [ ] Update `MemoryItemStore` for the changed `insert` and the new methods; fix existing `IngestTest` callers. New `core/SmsIngestTest.kt`:
  - `smsThenNotificationIsOneItem` and `notificationThenSmsIsOneItem` (the second also checks a repeat `onSms` returns 0).
  - `receiverAndInboxSameSmsOnce`: the same `RawSms` twice → 1 then 0.
  - `expiredOtpNotImported`; `purgedOtpNotReimported` (save, purge after 5 min, the same body again under a different `sentAt` → 0).
  - `recordOffSkipsSms`; `bankSmsMakesOneTxn` (the Alfalah debit via `onSms` and its notification → one item, one txn); `otpNeverTransaction`.
- [ ] Red, implement `core/Sms.kt` and the `Ingest`/`ItemStore` changes, green. Commit `Inflow: SMS ingest and merge with notifications`.

### K4: Android: schema v2, importer, receiver, module
- [ ] `SqlItemStore`: schema v2 migration, the new `ItemStore` methods, `purgeExpiredOtps` text tombstones (read `hash, text` of the expired rows in Kotlin, then insert both tombstones and delete, in one transaction). New `android/SqlLedgerStore.kt` implementing `LedgerStore` on the same `SQLiteDatabase` (share the instance through `StoreHolder`), plus queries `money(from, to)`, `listTxns(...)`, `item(id)`. `own` totals excluded. `StoreHolder.ingest` builds `Ingest` with a `Ledger` (owner name from meta `ownerName`) and `smsPackages = Sms.KNOWN_APPS + Telephony.Sms.getDefaultSmsPackage(context)`.
- [ ] `android/SmsImporter.kt`: `sync(context): Int` queries `Telephony.Sms.Inbox.CONTENT_URI` for `_id, address, body, date, date_sent` with `_id > lastSmsId` ascending, 500 rows per DB transaction, meta `lastSmsId` written after each batch. SMS package and label from `getDefaultSmsPackage` and `InflowListener.label`. Skips rows with blank address or body. Never logs text.
- [ ] `android/SmsReceiver.kt`: `SMS_RECEIVED` receiver, `goAsync()`, work on the listener's executor (expose it from `InflowListener` companion), `Telephony.Sms.Intents.getMessagesFromIntent` grouped by originating address, bodies concatenated in order, `sentAt` = first part's `timestampMillis`, `receivedAt` = now. Fires `onCaptured`.
- [ ] Manifest (module): `READ_SMS`, `RECEIVE_SMS`, and the receiver (`exported="true"`, `android:permission="android.permission.BROADCAST_SMS"`, filter `android.provider.Telephony.SMS_RECEIVED`). Check `app.json` `blockedPermissions` does not block them.
- [ ] Module: `smsGranted` in `getStatus`; `importSms` (AsyncFunction on a background thread, sends `onCaptured` when it imported anything); `money`, `listTxns`, `setOwnTransfer`, `getItem`, `getOwnerName`, `setOwnerName`, with the shapes in the TS contract.
- [ ] Gate green; merged release manifest still has no INTERNET (`aapt2 dump badging` or the merged manifest). Commit `Inflow: SMS import, receiver, ledger store, module API`.

## Agent T: TypeScript (one implementer, in parallel with K; never runs Gradle)

### T1: Contract and pure helpers
- [ ] Contract additions above in `modules/inflow-core/src/index.ts`.
- [ ] `src/money.ts`: `formatAmount(minor: number, currency: string): string` (`"PKR 1,500.00"`, `"PKR 593,249.01"`, integer arithmetic, no float rounding); `monthRange(year: number, month: number): { from: number; to: number }` (local time, month 0-11, handles December); `monthLabel(year, month): string` (`"November 2026"`); `shiftMonth(year, month, delta)`.
- [ ] `src/setup.ts`: a new row `{ id: 'sms', title: 'Read SMS', detail: …, status: smsGranted ? 'ok' : 'todo', action: 'sms' }`. **`setupComplete` ignores the `sms` row** (ruling: if the phone refuses SMS, the app must still open). Extend `SetupRow` ids and actions accordingly.
- [ ] Tests `src/__tests__/money.test.ts` and setup cases (sms row todo/ok; setup complete with SMS still todo). Add `money.test.ts` to the `test` script. Commit `Inflow: money helpers and SMS setup row`.

### T2: Screens
- [ ] `App.tsx`: tabs Home, Money, Settings. A setup action `sms` requests `PermissionsAndroid.requestMultiple([READ_SMS, RECEIVE_SMS])`; on grant, `importSms()`; on deny or never-ask-again, a `Notice`: "Android blocked SMS access. Open App info, tap the three dots, choose Allow restricted settings, then allow SMS." with an "Open App info" button (`openAppInfo`).
- [ ] Home: call `importSms()` (async, ignore errors in UI except a quiet retry next time) when Home mounts and on pull-to-refresh, if `smsGranted`. Money block: this month's per-account rows ("Alfalah 2310 · in PKR … · out PKR …") from `money(monthRange(now))`, tapping opens the Money tab; empty → "No bank messages this month." If SMS isn't granted, the row says "Allow SMS in Settings to see your spending."
- [ ] `src/MoneyScreen.tsx`: month switcher (previous / next, label), a `Group` per account with money in, money out, count; a "Where it went" `Group` of top merchants; a transactions list (`listTxns`, 50 per page, same paging as `ListScreen`) with counterparty or "Money in"/"Money out", account, signed amount, `whenLabel`, and an "Own transfer" `Pill`. Tapping opens `TxnSheet`.
- [ ] `src/TxnSheet.tsx`: amount, direction, account, counterparty, transaction id, time, an "Own transfer" `Segmented` (Yes/No) calling `setOwnTransfer`, and each source item's text via `getItem` ("This message was removed by its keep-for period." when null).
- [ ] Settings: "Your name" `Field` (helper text: "Inflow uses it to spot transfers between your own accounts.") saving with `setOwnerName`; the SMS row appears in the Setup group.
- [ ] `pnpm --filter inflow typecheck` and `pnpm --filter inflow test` green. Commit `Inflow: Money tab, money on Home, SMS setup`.

## Controller: close

- [ ] After K and T commit: Gradle gate, `pnpm test`, `pnpm typecheck` from the repo root of the worktree; check `git show --stat` per commit for file ownership.
- [ ] One whole-branch review on the most capable model over `inflow/stage-1..inflow/stage-2`, focused on the review-focus list and the K2/K3 risky commits; `invariant-reviewer` in parallel. One fix agent, one scoped re-review if the fix touches ledger, ingest or SQL.
- [ ] Update the handoff (state, phone checks to run, next step) and commit `Inflow stage 2: handoff`.
- [ ] Ask the owner for the go to release. Phone check (owner present, `device:<serial>` claimed, Store install only): SMS permission grant path (note whether "Allow restricted settings" was needed); the inbox imports once (count roughly matches the Messages app); a new bank SMS gives one item and one transaction; an OTP SMS disappears after 5 minutes and doesn't return after re-opening Home; a transfer between the owner's accounts is out of the totals; month totals look right against the owner's bank SMS.
