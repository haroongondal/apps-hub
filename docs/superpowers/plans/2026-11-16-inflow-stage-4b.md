# Inflow stage 4b (phone-test fixes, WhatsApp grouping and media) Implementation Plan

> **For agentic workers:** execute with `cd-engineering-tools:parallel-agents-coord` (it replaces `superpowers:subagent-driven-development` in this repo, per `~/.claude/CLAUDE.md`). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix what the 2026-11-16 phone test found (money out too low, WhatsApp chats split and duplicated, Ask AI money answer, AI summary quality, spend display, long Settings) and add what the owner asked for (WhatsApp messages grouped by sender with their own replies, all WhatsApp media the notifications expose stored encrypted and kept forever, WhatsApp text never deleted).

**Architecture:** Same split as before: pure Kotlin in `core/` tested on the JVM, Android glue in `android/`, RN renders through the TS contract. New: a chat-identity step in the notification parser, an encrypted media store, schema v5.

**Tech stack:** unchanged (no new dependency). Media encryption uses `javax.crypto` AES-256-GCM.

**Spec:** `docs/superpowers/specs/2026-11-13-inflow-design.md`. Owner overrides (2026-11-16): (1) the design's non-goal "saving photos, voice notes or attachments" is **reversed for WhatsApp**: store every media file the notification exposes; (2) WhatsApp message text is kept forever and never deleted automatically; (3) WhatsApp chats are grouped by who they are with.

## Verified on the phone (2026-11-16, do not re-derive)

- WhatsApp posts one MessagingStyle notification per chat: `tag` is a stable per-chat hash, `shortcutId` looks like `<digits>@lid`, `extras.android.messages` holds each message with `sender` (the contact's name, or `You` for the owner), `sender_person`, `text`, `time`; `android.messagingUser` is the owner; `android.isGroupConversation=false` for 1:1; `android.title` **changes to "You" after the owner replies**, which made `NotificationParser` file the whole chat under conversation "You" and (the item hash includes the conversation key) store the contact's messages a second time. There is also a GROUP_SUMMARY InboxStyle record (already skipped).
- WhatsApp is in `Retention.KEEP_FOREVER` (keep for forever) and in `OtpDetector.EXEMPT_PKGS`; nothing else deletes it. The only automatic deletes are OTP items of non-messaging apps (5 min), the per-app keep-for choice and "Stop and delete".
- The 54 November SMS from sender 8287 use nine Alfalah formats; `Bank.kt` reads three. Replayed on the phone's real messages: the app's 19 card charges (PKR 58,090.20) and 1 credit are exactly what the Money tab shows; 34 messages are not read. A QR message and a RAAST message for the same payment share one `Tx ID`.
- Media in notifications was **not** inspected (owner skipped the media test). Build from documented fields and report what happened on the phone (K4 counters).

## Global constraints (in addition to earlier stages)

- WhatsApp message text is never changed or auto-deleted; duplicates are removed only when an identical (sender, time, text) row stays.
- Media is stored only encrypted, never sent to the AI, never in backups (`allowBackup=false` stays), never logged. Media files follow their item: removed when the item is removed.
- No new permission, no new network host.
- Amounts stay integers in minor units; Dedup rules from stage 2 apply to every new format.
- New `*.test.ts` go in `apps/inflow/package.json`'s `test`; erasable TS; sentence-case copy.

## Rulings (controller, before dispatch)

- R35: Ask AI sends ledger transactions of any age (not only since the first key), still excluding OTP, blocked, record-off and own-transfer rows. Reverses R31 because the owner asks money questions about the whole month; cost if wrong: older amounts, accounts and merchants go to the AI provider when the owner asks.
- R36: a 1:1 WhatsApp chat is keyed by the contact's name (`senderKey(pkg, name)`), matching the keys of rows already saved; a group is keyed by its title. A learned `chat_map(tag → name)` resolves a notification that contains only the owner's own message. Cost if wrong: two contacts with the same display name share a thread.
- R37: bank fees ("with Fee PKR 5.00") are not added to the amount; amounts stay as the bank states them. Cost: money out is short by the fees.
- R38: a counterparty is the owner's own account when its words are the owner's name plus at most one bank tag (NayaPay, SadaPay, JazzCash, Easypaisa, UPaisa, TMB, MMBL, BAF, BAFL, or an uppercase BIC like UNILPKKARTG).
- R39: media limits: 20 MB per file; BigPicture bitmaps stored as JPEG (quality 90); media is deduplicated by SHA-256 of its bytes. Voice notes and documents are stored only if the notification actually carries them.
- R40: Settings order becomes Setup, Gmail, AI, Renamed senders, Apps (Apps last, it is the long list).

## Review focus

1. **Chat identity:** the same chat before and after the owner replies is one thread; a reply-only notification lands in the contact's thread; two chats never merge; a group stays a group. Pinned in K2.
2. **No data lost:** the v5 migration re-files "You"-conversation copies and deletes only exact duplicates whose twin stays; WhatsApp text count after the migration equals the count before minus those duplicates. Pinned in K2.
3. **Money:** every message format in the templates below parses to the stated values; the QR and RAAST message of one payment give one transaction; the owner's own wallet is `own`; nothing in the Alfalah OTP/other text is misread. Pinned in K1.
4. **Media:** an unreadable URI never crashes capture or loses the message text; files are encrypted at rest (ciphertext differs from plaintext) and removed with their item. Pinned in K4.
5. **Ask AI** answers a money question from the ledger and never sends OTP or blocked rows. Pinned in K3.

## Interfaces (shared by both agents; follow exactly)

### K1: Alfalah formats (Kotlin `core/Bank.kt`, `core/Ledger.kt`)

All wording below is the real format with the owner's numbers and names replaced. `BankParser.parse` must return exactly these values (account `"Alfalah 2310"` in every case; amounts in paisa):

| Message | direction | amount | counterparty | txId |
|---|---|---|---|---|
| `Dear Customer,\nPKR 5,000.00 Debited from your A/C: 0847-1***2310 on 2-Nov-26 at 18:45:48 Bal: Reply with AB 021111225111` | OUT | 500000 | null | null |
| `PKR 2490 has been transferred to Test Shop from your BAFL A/C *2310 on 11-Nov-2026 at 12:30 via QR Tx ID FT26315ABCDEFGH1` | OUT | 249000 | `Test Shop` | `FT26315ABCDEFGH1` |
| `PKR 2,490.00 paid to Test Shop from your BAFL A/C *2310 on 11-Nov-2026 12:32 via RAAST Tx FT26315ABCDEFGH1` | OUT | 249000 | `Test Shop` | `FT26315ABCDEFGH1` |
| `PKR 1,500.00 sent to Some Person TMB from your BAF A/C **2310 on 3-Nov-26 10:15:22 with Fee PKR 5.00 via FT Tx ID FT26307ZZZZZZZZZ` | OUT | 150000 | `Some Person TMB` | `FT26307ZZZZZZZZZ` |
| `PKR 300 sent to Some Person PK***1234 from your BAF A/C *2310 on 5-Nov-26 09:10 Tx ID FT26309YYYYYYYYY` | OUT | 30000 | `Some Person` | `FT26309YYYYYYYYY` |
| `PKR 3,897.00 Paid to NTEL Consumer ID 123456 from your BAF A/C **2310 on 4-Nov-26 11:11:11 via UBPS Tx ID FT26308XXXXXXXX1` | OUT | 389700 | `NTEL` | `FT26308XXXXXXXX1` |
| `PKR 50,000.00 received from Some Person BAF in your BAF A/C **2310 on 6-Nov-26 14:00:00 via FT Tx ID FT26310WWWWWWWWW` | IN | 5000000 | `Some Person BAF` | `FT26310WWWWWWWWW` |
| `PKR 1000 received from Some Person MUCBPKKKRTG in your BAF A/C *2310 via your Raast ID on 08-11-26 at 12:00 Tx ID FT26312VVVVVVVVV` | IN | 100000 | `Some Person MUCBPKKKRTG` | `FT26312VVVVVVVVV` |

Counterparty cleaning: collapse whitespace; drop a trailing masked IBAN `PK***####`; drop ` Consumer ID <digits>` and everything after it. The three existing SMS patterns and the two email patterns stay first and unchanged.

```kotlin
// core/Ledger.kt OwnTransfer (changed)
object OwnTransfer {
  /** R38: equal after normalising, or owner name followed by exactly one bank tag token. */
  fun nameMatches(counterparty: String?, ownerName: String?): Boolean
  val BANK_TAGS: Set<String>  // NAYAPAY SADAPAY JAZZCASH EASYPAISA UPAISA TMB MMBL BAF BAFL
}
```
A token also counts as a bank tag when it matches `^[A-Z]{4,}PK[A-Z0-9]{2,}$` (BIC-like) in the raw counterparty.

### K2: chat identity (Kotlin `core/Capture.kt`, `core/NotificationParser.kt`, `core/Ingest.kt`, `core/ItemStore.kt`, `android/RawFromSbn.kt`, `android/SqlItemStore.kt`)

```kotlin
data class RawMessage(val sender: String?, val text: String, val time: Long, val own: Boolean = false,
  val media: RawMedia? = null)           // media is added by K4; K2 only adds `own`
data class RawNotification(/* existing */, val chatTag: String? = null, val shortcutId: String? = null)
interface ChatDirectory { fun nameFor(tag: String): String?; fun learn(tag: String, name: String) }   // ItemStore extends it
object NotificationParser { fun parse(raw: RawNotification, ownPkg: String, chats: ChatDirectory? = null): List<Capture> }
```
Rules for `fromMessages` (MessagingStyle):
1. `own` = `RawMessage.own` or sender null or sender equals `You` ignoring case. `RawFromSbn` sets `own` by comparing `message.person.key` (else name) with `MessagingStyle.user`.
2. Group: `isGroupConversation` or non-blank `conversationTitle` → conversation = that title, key = `senderKey(pkg, title)`.
3. Otherwise 1:1: conversation = the first non-own message's sender; else the notification title unless it equals `You` (ignoring case); else `chats.nameFor(chatTag ?: shortcutId)`; else the title as is. Key = `senderKey(pkg, name)`. When a non-own sender name is known and `chatTag ?: shortcutId` is not null, call `chats.learn(tag, name)`.
4. Own messages keep sender `You`, other messages their sender; all share the conversation. Hash uses this conversation key (so a message already saved in the contact's thread is not saved again).
Single-text (non-MessagingStyle) notifications keep today's behaviour.
Schema v5 (K2 lands the whole v5 step so every commit compiles; K4 adds only its media table to the same step if not yet released — K2 writes `chat_map` and the media table together):
```sql
CREATE TABLE chat_map(tag TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE media(id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL,
  size INTEGER NOT NULL, file TEXT NOT NULL, sha TEXT NOT NULL UNIQUE, at INTEGER NOT NULL);
CREATE INDEX media_item ON media(item_id);
```
Legacy repair (in the v5 step, one transaction): for items with `pkg='com.whatsapp'` and `conversation_key = senderKey('com.whatsapp','You')`: if `sender` is not `You` → move to the sender's thread (`conversation = sender`, `conversation_key = senderKey(pkg, sender)`, `hash` recomputed with the same formula as the parser) and delete the row only if another row with the same pkg, sender, posted_at and text already exists; if `sender` is `You` → move to the thread of the nearest other-sender WhatsApp item captured within 5 minutes, else leave. Never delete an item that has no identical twin. A JVM test runs the same repair logic through a pure function over rows (`LegacyRepair.plan(rows): List<Action>`), the SQL step only executes its plan.
K2 also adds the WhatsApp retention pins as tests: `whatsappIsKeptForever`, `whatsappCodeLikeTextIsNeverAnOtp`, `purgeNeverTouchesWhatsappWithoutAnExplicitChoice`.

### K3: Ask AI and AI quality (Kotlin `android/SqlLedgerStore.kt`, `android/AiRunner.kt`, `core/Ai.kt`, `core/AiProvider.kt`, `core/AiQueue.kt`)

- R35: `askTxns(from, to, limit)` drops the `t.at >= aiSince` condition (keep the source filter and own-transfer exclusion). `AiRunner.ask` stops binding `enabledSince`. Test the pure part that exists; prove the SQL in sqlite3.
- `AiInput` gains `conversation: String?` and `own: Boolean`; `AiBatch.user` includes both per item; the system prompt adds: each summary must describe only that item's own text; "you" means the owner.
- A reply whose results contain two identical summaries for items with different texts drops all but the first of those results (they are retried once). Test `identicalSummariesForDifferentTextsAreDropped`.
- `Prices.cost`: when the reply's `usage` is all zeros, estimate tokens as characters / 4 for input and output so the daily cap still counts. Test `missingUsageIsEstimated`.

### K4: WhatsApp media (Kotlin `core/Media.kt`, `android/MediaStore.kt`, `android/RawFromSbn.kt`, `core/Ingest.kt`, `android/SqlItemStore.kt`, `InflowCoreModule.kt`)

```kotlin
data class RawMedia(val mime: String, val bytes: ByteArray)
object MediaKind { fun of(mime: String): String }   // image, video, audio, document, sticker (image/webp), other
interface MediaSink { fun save(itemId: Long, m: RawMedia, at: Long): Boolean }   // false when too big (> 20 MB) or duplicate
// Ingest gets `media: MediaSink? = null`; after an item is inserted, each RawMessage.media of that item's message is passed to it.
```
- `RawFromSbn`: for every MessagingStyle message with `dataUri` and `dataMimeType`, open the URI with the `ContentResolver`, read up to 20 MB, catching every exception (count it); for a notification with `EXTRA_PICTURE` or `EXTRA_PICTURE_ICON` (BigPicture) store the bitmap as JPEG q90. Never read the contact's `largeIcon`.
- `android/MediaStore.kt`: AES-256-GCM, key = HMAC-SHA256(database key, `"inflow-media"`); file layout `[12-byte IV][ciphertext+tag]` in `filesDir/media/<random>`; `sha` = SHA-256 of the plaintext bytes (dedupe); deleting an item (retention, OTP purge, `deleteApp`, legacy repair) deletes its rows and files after the transaction commits.
- Counters in meta: `mediaSaved`, `mediaBytes`, `mediaUnreadable`, `mediaTooBig`, and `mediaLastMime` (the last mime seen) for the phone check.
- Module (and TS contract, T1 writes it): `mediaFor(itemId): MediaInfo[]` (id, kind, mime, size), `readMedia(mediaId): string` (base64 of the decrypted bytes, only for kind image/sticker and size ≤ 8 MB, else throws), `openMedia(mediaId): void` (decrypts to `cacheDir/open/<id>.<ext>`, launches `ACTION_VIEW` through a `FileProvider` with authority `com.haroon.inflow.media`, grants read; the folder is cleared at the next start), `mediaStats(): { saved, bytes, unreadable, tooBig, lastMime }`, and `Item.mediaCount`.
- Tests: `MediaStoreTest` with a fake key: round trip, ciphertext ≠ plaintext, dedupe, too-big refused, file removed with the item; `IngestMediaTest`: an item with media saves the file and the text; a failing sink never loses the item.

### TS contract (T1)

```ts
export interface MediaInfo { id: number; kind: 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'other'; mime: string; size: number }
export interface MediaStats { saved: number; bytes: number; unreadable: number; tooBig: number; lastMime: string | null }
export interface Item { /* earlier */ mediaCount: number }
// added to InflowCoreApi: mediaFor(itemId: number): MediaInfo[]; readMedia(mediaId: number): string; openMedia(mediaId: number): void; mediaStats(): MediaStats
```

---

## Agent K: Kotlin (one implementer, tasks in order, one commit each)

Gradle from `apps/inflow/android` with `JAVA_HOME` and `ANDROID_HOME` exported: `./gradlew :inflow-core:testDebugUnitTest`; gate `./gradlew :inflow-core:testDebugUnitTest :app:assembleDebug :app:processReleaseMainManifest --rerun-tasks`.

### K1: Alfalah formats, QR/RAAST twins, own wallet
- [ ] Tests first in `BankParserTest` (the table above, one test per row, exact values), `LedgerTest`: `qrAndRaastOfOnePaymentAreOneTxn` (the QR and RAAST rows, both SMS channel, 2 min apart → one txn; two real identical payments with different Tx IDs stay two), `sentToOwnNayaPayIsOwn` (owner "Haroon Mukhtar", `... sent to Haroon Mukhtar NayaPay ...` → own), `receivedFromOwnUblBicIsOwn`, `sameNameWithSurnameIsNotOwn` (`Haroon Mukhtar Khan` → not own), `fourDebitsSecondsApartStayFour` (four `Debited from` messages, 5,000 each, within 2 minutes, no Tx ID → four txns), `moneyOutSumsEveryFormat` (all OUT rows above, QR/RAAST once → the expected paisa total).
- [ ] Red, implement, green. Commit `Inflow: read all Alfalah SMS formats, own wallet transfers`.

### K2: chat identity, schema v5, legacy repair, WhatsApp retention pins
- [ ] Tests (`NotificationParserTest`, `IngestTest`, `LegacyRepairTest`): `replyRetitlesNotificationButStaysOneThread` (notification A: title `Sunflower`, messages from Sunflower; notification B: title `You`, same messages plus an own reply → every item has conversation `Sunflower`; Ingest saves 3 items total, not 5), `replyOnlyNotificationUsesLearnedName` (tag learned from A, B contains only the own message), `groupStaysGroup`, `ownMessageSenderIsYou`, `twoContactsStayTwoThreads`, the K2 retention pins, `LegacyRepairTest` (a "You"-conversation copy with a twin is deleted, without a twin is moved, an own message moves next to the nearest other-sender item, nothing else changes; text count preserved).
- [ ] Red, implement (parser, `RawFromSbn` fields, `ChatDirectory` in `ItemStore`/`SqlItemStore`/`MemoryItemStore`, schema v5 step with `chat_map`, `media` table and the legacy repair), green. Commit `Inflow: group WhatsApp by contact, schema v5, legacy repair`.

### K3: Ask AI from the ledger, AI quality
- [ ] Tests as listed under K3; `ensureSchema` untouched. Commit `Inflow: Ask AI money from the ledger, steadier AI summaries`.

### K4: WhatsApp media
- [ ] Tests as listed under K4, then implement. The gate must include `:app:processReleaseMainManifest` and list permissions (no new ones). `FileProvider` goes in the module manifest with a `res/xml` path file for `cache/open/`. Commit `Inflow: store WhatsApp media encrypted`.

## Agent T: TypeScript (one implementer, in parallel with K; never runs Gradle)

### T1: Contract and helpers
- [ ] Contract above in `modules/inflow-core/src/index.ts`. `src/ai.ts` `capLabel`: spend below $0.01 shows four decimals (`"$0.0004 of $0.50 today"`), else two; new `src/media.ts`: `sizeLabel(bytes: number): string` (`"1.2 MB"`, `"340 KB"`, `"12 B"`), `mediaKindLabel(kind): string` (`"Photo"`, `"Video"`, `"Voice message"`, `"Document"`, `"Sticker"`, `"File"`), `mediaStatsLabel(s: MediaStats): string` (`"No media saved yet"`, `"12 files saved (3.4 MB). 2 could not be read."`). Tests `ai.test.ts` (extend) and `media.test.ts` (add to `test`). Commit `Inflow: media contract and helpers`.

### T2: Settings order, media line, Ask AI copy
- [ ] `SettingsScreen.tsx`: R40 order (Setup group first, Gmail, AI, Renamed senders, Apps last); a "Saved media" row under Apps using `mediaStatsLabel(mediaStats())` with the footer "Photos, videos and files that WhatsApp shows in its notifications are saved here, encrypted, and kept as long as the message." Ask AI footer: "Questions about money use all your saved transactions." Commit `Inflow: Settings order, media status, Ask AI copy`.

### T3: Media in threads and the item sheet
- [ ] `ItemSheet.tsx`: for `item.mediaCount > 0` a "Media" group: images and stickers shown inline (`readMedia` base64 `data:` URI in an `Image`, width 100%, rounded), other kinds a `Row` with `mediaKindLabel`, size and an "Open" button (`openMedia`); errors in a `Notice` ("This file could not be opened."). `ListScreen.tsx` rows: a small kind label (`Photo`, …) when `mediaCount > 0`. Commit `Inflow: show saved media`.

## Controller: close

- [ ] Gradle gate, `pnpm test`, `pnpm typecheck`; `git show --stat` per commit; module function names equal the TS contract.
- [ ] One whole-branch review on the most capable model over `inflow/stage-4..inflow/stage-4b` (chat identity and v5 repair first, media encryption and file lifecycle, money formats), `invariant-reviewer` in parallel (manifest, FileProvider exposure, logs, backup). One fix agent, one scoped re-review.
- [ ] Handoff and AGENTS.md (media, WhatsApp grouping) updated, commit `Inflow stage 4b: handoff`.
- [ ] Phone (owner present): build the release APK from the branch, check `dumpsys package` (versionCode, installer null, same debug signature) and `adb install -r` over the existing adb-installed Inflow (keeps data: this is the v4→v5 upgrade test). Then: the old duplicated "You" thread is repaired; a reply in WhatsApp keeps one thread; Money out for November matches the replay (card 58,090.20 + the new formats, QR/RAAST once); Ask AI answers the money question; ask the friend to send a photo, video, voice note, document, sticker, GIF, location and contact, then read Settings > Saved media and the item sheets and record what was and was not stored.
