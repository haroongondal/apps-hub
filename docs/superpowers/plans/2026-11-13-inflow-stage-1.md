# Inflow stage 1 (capture and browse) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `cd-engineering-tools:parallel-agents-coord` to implement this plan task by task (it replaces `superpowers:subagent-driven-development` in this repo, per `~/.claude/CLAUDE.md`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private Android app, installed from the Store, that saves every notification (app, sender, conversation, title, full text, time) into an encrypted on-phone store and lets the owner browse it from a summary home screen, threads and search, behind a fingerprint lock.

**Architecture:** New Expo app `apps/inflow` with one Expo local module `apps/inflow/modules/inflow-core`. Kotlin owns everything that matters: a `NotificationListenerService` turns each `StatusBarNotification` into a plain `RawNotification`, pure Kotlin in `core/` parses, filters and de-duplicates it, and an SQLCipher database stores it. React Native only renders, through a thin TS adapter, using `@apps-hub/ui`.

**Tech Stack:** Expo SDK 54, RN 0.81, TypeScript 5.9, Kotlin, `net.zetetic:sqlcipher-android` + `androidx.sqlite:sqlite:2.5.0`, `androidx.biometric:biometric:1.1.0`, JUnit 4 JVM tests, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-13-inflow-design.md` (stage 1 section and everything it references). Handoff: `docs/handoffs/inflow.md`.

## Global Constraints

- App id `com.haroon.inflow`, name "Inflow", Store release id `inflow`, brand key `inflow`, Android only, `android.minSdkVersion=33` (same as Strongroom).
- Kotlin owns capture and storage; RN only renders. No React/RN imports in Kotlin `core/`; `core/` has no `android.*` imports so JVM tests run it.
- Every screen uses `@apps-hub/ui` (`ThemeProvider brand="inflow"`); never hand-rolled colours or fonts. Copy is sentence case, active voice, plain words; errors say what happened and how to fix it. No emoji, no ALL CAPS.
- Nothing leaves the phone in stage 1: no `INTERNET` permission. `allowBackup=false` plus data extraction rules that exclude every domain.
- Inflow only reads notifications. It never cancels, snoozes or changes them.
- Original text is stored exactly as received. Only the separate `search` column is normalised.
- OTPs: deleted whole 5 minutes after capture, tombstoned by hash so they never come back, and hidden from every query once expired even before the purge runs.
- Defaults: every app recorded except `com.haroon.strongroom`; Inflow never records itself. Keep for forever: `com.google.android.apps.messaging`, `com.android.mms`, `com.google.android.gm`, `com.whatsapp`, `com.whatsapp.w4b`, `org.telegram.messenger`, `org.thoughtcrime.securesms`, `com.facebook.orca`. Every other app: 90 days. Choices offered: forever, 365, 90, 30 days.
- New `*.test.ts` files must be listed in the package's `test` script. Erasable TS only, `.ts` import extensions.
- Never adb-install on the owner's phone; release through the Store only on the owner's go. Claim `device:<serial>` with coord before driving the phone. No Claude attribution lines in commits.
- New Gradle dependencies go through the `upgrading-dependencies` skill (licence audit, exact versions).

## Review Focus

1. **Re-posted notifications.** WhatsApp and SMS apps re-post the whole MessagingStyle history with every new message, and apps update one key repeatedly. Expect exactly one saved item per real message. Pinned in Task 4 (`repostedHistorySavesEachMessageOnce`, `sameKeySameTextIsOneItem`).
2. **Capture silently stops.** HyperOS kills the listener, or the owner revokes access. Expect a warning at the top of Home that says what to do. Pinned in Task 7 (`healthNotice` tests).
3. **The database key is lost** (Keystore wiped, data restored without the key). Expect a clear error and the old database left on disk, never silently replaced by an empty one. Pinned in Task 5 (`openPlan` tests).
4. **Urdu, Roman Urdu, emoji and very long text.** Expect the text kept byte for byte and found by search with or without harakat or yeh/kaf variants. Pinned in Tasks 2 and 3.
5. **Search input with `%`, `_`, `\` or quotes.** Expect a literal match, never a wildcard or an error. Pinned in Task 3 (`likeTermsEscapesWildcards`).

---

## File structure

```
apps/inflow/
  app.json, package.json, tsconfig.json, index.ts, metro.config.js, App.tsx
  assets/icon.svg, icon.png, android-icon-foreground.png      (placeholder icon, Task 1)
  android/                                                     (committed `expo prebuild`, Task 1)
    app/src/main/res/xml/data_extraction_rules.xml
  tools/__tests__/backup-rules.test.mjs
  src/
    setup.ts        setup rows (pure)
    health.ts       Home capture-health notice (pure)
    format.ts       time and keep-for labels (pure)
    __tests__/setup.test.ts, health.test.ts, format.test.ts
    LockScreen.tsx, SetupScreen.tsx, HomeScreen.tsx, ListScreen.tsx,
    ItemSheet.tsx, RenameSheet.tsx, SettingsScreen.tsx
  modules/inflow-core/
    package.json, expo-module.config.json
    src/index.ts                                               TS contract + adapter
    android/build.gradle, src/main/AndroidManifest.xml
    android/src/main/java/expo/modules/inflowcore/
      InflowCoreModule.kt
      core/   Capture.kt, NotificationParser.kt, SenderKey.kt, OtpDetector.kt,
              SearchText.kt, Retention.kt, ItemStore.kt, Ingest.kt, OpenPlan.kt
      android/ DbKey.kt, SqlItemStore.kt, InflowListener.kt, RawFromSbn.kt, Lock.kt
    android/src/test/java/expo/modules/inflowcore/core/
      NotificationParserTest.kt, OtpDetectorTest.kt, SearchTextTest.kt,
      IngestTest.kt, MemoryItemStore.kt, OpenPlanTest.kt
```

Model every file you create on its Strongroom counterpart (`apps/strongroom/...`): `package.json`, `app.json`, `metro.config.js`, `tsconfig.json`, `index.ts`, the module's `build.gradle` and `expo-module.config.json`, and `tools/__tests__/backup-rules.test.mjs`.

**Order and parallelism:** Task 1 first. Tasks 2 and 3 can run in parallel. Task 4 needs 2 and 3. Task 5 needs 4. Task 6 needs 4 and 5. Task 7 (TS helpers and contract) can start after Task 1 and runs alongside 2–6. Task 8 needs 6 and 7. Task 9 comes last.

Gradle test command used below (from `apps/inflow/android`, with `JAVA_HOME` exported as in AGENTS.md):
`./gradlew :inflow-core:testDebugUnitTest` and, for the compile gate, `./gradlew :inflow-core:testDebugUnitTest :app:assembleDebug`.

---

### Task 1: App shell, brand, backup rules, Store registration

**Files:**
- Create: `apps/inflow/{app.json,package.json,tsconfig.json,index.ts,metro.config.js,App.tsx}`, `apps/inflow/assets/*`, `apps/inflow/modules/inflow-core/{package.json,expo-module.config.json,src/index.ts,android/build.gradle,android/src/main/AndroidManifest.xml,android/src/main/java/expo/modules/inflowcore/InflowCoreModule.kt}`
- Create (prebuild): `apps/inflow/android/**`, then `apps/inflow/android/app/src/main/res/xml/data_extraction_rules.xml`
- Create: `apps/inflow/tools/__tests__/backup-rules.test.mjs`
- Modify: `packages/ui/src/tokens.ts` (add `inflow` to `BrandKey` and `brands`), `packages/ui/web/tokens.css` (regenerated)
- Modify: `tools/release/src/apps.ts` (add the entry), `AGENTS.md` (app list + Inflow native gate), `docs/app-store.md` (§6 verification list: add `com.haroon.inflow`)

**Interfaces:**
- Produces: workspace package `inflow-core` (main `src/index.ts`), Kotlin module class `expo.modules.inflowcore.InflowCoreModule` with `Name("InflowCore")`, Gradle project `:inflow-core`.

- [ ] **Step 1: Write the failing backup test.** Copy Strongroom's `backup-rules.test.mjs` to `apps/inflow/tools/__tests__/backup-rules.test.mjs` unchanged. It asserts `android:allowBackup="false"`, `android:dataExtractionRules="@xml/data_extraction_rules"`, and that `cloud-backup` and `device-transfer` both exclude `root`, `file`, `database` and `sharedpref`.
- [ ] **Step 2: Create the app files.**
  - `package.json`: name `inflow`, scripts `start`, `android`, `prebuild` (`expo prebuild --platform android`), `typecheck` (`tsc --noEmit`) and `test` (`node --test tools/__tests__/backup-rules.test.mjs`, extended in Task 7), with Strongroom's dependency versions plus `"inflow-core": "workspace:*"`.
  - `app.json`: Strongroom's `app.json` with these changes: name "Inflow", slug `inflow`, version `0.1.0`, package `com.haroon.inflow`, `allowBackup: false`, the same `blockedPermissions` list, and **no** `permissions` entry, so no INTERNET.
  - `App.tsx`: `<ThemeProvider brand="inflow">` around a `Screen` with `Header title="Inflow"`.
  - Module skeleton: `InflowCoreModule` with only `Name("InflowCore")`. Its `build.gradle` follows Strongroom's: namespace `expo.modules.inflowcore`; dependencies `androidx.biometric:biometric:1.1.0`, `androidx.appcompat:appcompat:1.7.0`, `net.zetetic:sqlcipher-android:<latest 4.x>@aar` (choose the version with the `upgrading-dependencies` skill and record its licence in the commit message), `androidx.sqlite:sqlite:2.5.0`, and `testImplementation("junit:junit:4.13.2")`.
- [ ] **Step 3: Add the brand.** Add `inflow` to `BrandKey` and to `brands` as `{ name: 'Inflow', hue: 190, accent: { dark: '#5EEAD4', light: '#0F766E' }, onAccent: { dark: '#042F2C', light: '#FFFFFF' } }` (provisional, like Deputy's, until there is an icon). Run `pnpm --filter @apps-hub/ui build:css`.
- [ ] **Step 4: Prebuild and add the backup rules.** Run `pnpm install`, then `pnpm --filter inflow prebuild`. Set `android.minSdkVersion=33` in `android/gradle.properties`. Copy Strongroom's `data_extraction_rules.xml` and point the manifest at it as Strongroom does.
- [ ] **Step 5: Register for release.** Add `inflow: { name: 'Inflow', dir: 'apps/inflow', android: { packageName: 'com.haroon.inflow' } }` to `tools/release/src/apps.ts`. Add Inflow to AGENTS.md's app list, plus this gate under Verification Commands:
  ```bash
  # Native compile gate (Inflow):
  cd apps/inflow/android && JAVA_HOME=$JAVA_HOME ./gradlew \
    :inflow-core:testDebugUnitTest :app:assembleDebug
  ```
- [ ] **Step 6: Verify.** Run `pnpm --filter inflow test` (PASS), `pnpm --filter @apps-hub/ui test` (PASS, including WCAG for `inflow` light and dark), `pnpm --filter @apps-hub/release test` (PASS), `pnpm --filter inflow typecheck` (no errors), and the Gradle compile gate (BUILD SUCCESSFUL).
- [ ] **Step 7: Commit** with the message `Inflow: app shell, brand, backup rules, Store registration`.

### Task 2: Notification parser and sender keys (pure Kotlin)

**Files:**
- Create: `core/Capture.kt`, `core/SenderKey.kt`, `core/NotificationParser.kt`
- Test: `core/NotificationParserTest.kt`

**Interfaces:**
- Produces:
  ```kotlin
  data class RawMessage(val sender: String?, val text: String, val time: Long)   // sender null = the owner
  data class RawNotification(
    val pkg: String, val appLabel: String, val key: String, val postTime: Long,
    val ongoing: Boolean, val groupSummary: Boolean,
    val title: String?, val text: String?, val bigText: String?, val subText: String?,
    val conversationTitle: String?, val isGroupConversation: Boolean,
    val messages: List<RawMessage>, val textLines: List<String>,
  )
  data class Capture(
    val pkg: String, val appLabel: String,
    val sender: String?, val senderKey: String?,
    val conversation: String?, val conversationKey: String?,
    val title: String?, val text: String, val postedAt: Long,
    val hash: String, val deletedPlaceholder: Boolean,
  )
  object NotificationParser { fun parse(raw: RawNotification, ownPkg: String): List<Capture> }
  fun senderKey(pkg: String, sender: String): String
  ```

Rules the tests pin:
- Nothing is returned for `pkg == ownPkg`, `ongoing`, `groupSummary`, or when title, text, bigText and textLines are all blank.
- **With messages (MessagingStyle):** one Capture per message. `sender` is `message.sender ?: "You"`. `conversation` is `conversationTitle` when present, else `raw.title`. `conversationKey` is `senderKey(pkg, conversation)`. `text` is `message.text` unchanged. `postedAt` is `message.time`. `hash` is the SHA-256 hex of `pkg \u0000 conversationKey \u0000 sender \u0000 postedAt \u0000 text`.
- **Without messages:** `sender` is `title`, `text` is `bigText ?: text ?: textLines.joinToString("\n")`, conversation is null, `postedAt` is `postTime`, and `hash` is the SHA-256 of `pkg \u0000 key \u0000 title \u0000 text` (no time, so a re-post with the same content is the same item).
- `senderKey`: when the sender, with spaces, `+` and `-` removed, is all digits, the key is `"num:"` + those digits, keeping only the last 10 when there are more than 10. That makes an SMS short code the same sender in every app. Otherwise the key is `"$pkg:"` + the sender lowercased (Locale.ROOT), trimmed, with whitespace runs collapsed to one space.
- `deletedPlaceholder` is true when the trimmed text equals one of `"This message was deleted"`, `"You deleted this message"` or `"یہ پیغام حذف کر دیا گیا تھا"` (case-insensitive for Latin).

- [ ] **Step 1: Write failing tests** in `NotificationParserTest`:
  - `skipsOwnOngoingAndSummary`: each of the three cases gives an empty list.
  - `smsShortCodeKeepsTextExactly`: an SMS app notification with title `"8287"`, MessagingStyle, one message holding the Alfalah debit-card sample verbatim from the spec. Expect one Capture with `text` equal to the sample, `senderKey == "num:8287"` and `conversationKey == "num:8287"`.
  - `whatsappGroupMessages`: `conversationTitle "Family group"`, `isGroupConversation true`, messages from `"Ammi"` and `"Ali"`. Expect 2 captures, each with its own sender, `conversation "Family group"` and `conversationKey "com.whatsapp:family group"`.
  - `gmailUsesBigText`: pkg `com.google.android.gm`, title `"Bank Alfalah"`, text `"Transaction alert"`, bigText `"Transaction alert\nPKR 1,500.00 charged…"`. Expect `sender "Bank Alfalah"` and `text == bigText`.
  - `sameContentSameHashAcrossReposts`: the same non-messaging raw with a different `postTime` gives the same hash.
  - `urduAndEmojiUntouched`: text `"کل میٹنگ ہے 👍"` comes back byte for byte.
  - `deletedPlaceholderFlagged`: a message text of `"This message was deleted"` gives `deletedPlaceholder == true`.
  - `phoneNumbersNormalise`: `senderKey("x", "+92 300 1234567") == "num:3001234567"`.
- [ ] **Step 2: Run `./gradlew :inflow-core:testDebugUnitTest`.** Expect FAIL (unresolved references).
- [ ] **Step 3: Implement** `Capture.kt`, `SenderKey.kt` and `NotificationParser.kt` with the signatures above. Use `java.security.MessageDigest` for SHA-256.
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** with the message `Inflow: notification parser and sender keys`.

### Task 3: OTP detection and search text (pure Kotlin)

**Files:**
- Create: `core/OtpDetector.kt`, `core/SearchText.kt`
- Test: `core/OtpDetectorTest.kt`, `core/SearchTextTest.kt`

**Interfaces:**
- Produces:
  ```kotlin
  object OtpDetector {
    val EXEMPT_PKGS: Set<String>   // chat apps: com.whatsapp, com.whatsapp.w4b, org.telegram.messenger,
                                   // org.thoughtcrime.securesms, com.facebook.orca, com.instagram.android
    fun isOtp(pkg: String, text: String): Boolean
  }
  object SearchText {
    fun normalize(s: String): String
    fun likeTerms(query: String): List<String>   // each ready for `search LIKE ? ESCAPE '\'`
  }
  ```

Rules: `isOtp` is false for `EXEMPT_PKGS`, so chats saying "my pin is 4455" are kept. Otherwise it is true when the text has a keyword (`otp`, `one-time`, `one time`, `verification`, `verify`, `code`, `pin`, `passcode`, `password`, `کوڈ`, case-insensitive, matched as whole words) **and** a standalone 4–8 digit token, **unless** it looks like a transaction: an amount (`(PKR|Rs\.?|USD)\s?[\d,]+(\.\d+)?`) together with one of `credited|debited|charged|received|transferred|sent|paid|withdrawn`. `normalize` ports `packages/library-core/src/normalize.ts` exactly (NFKC, strip U+064B–U+065F, U+0670, U+0640, U+200C, U+200D, fold U+064A→U+06CC and U+0643→U+06A9) and then lowercases with Locale.ROOT. `likeTerms` normalises, splits on whitespace, drops blanks, keeps at most 8 terms, escapes `\`, `%` and `_` with `\`, and wraps each in `%…%`.

- [ ] **Step 1: Write failing tests.**
  - `OtpDetectorTest`:
    - `ownerSamplesAreNotOtp`: each of the four spec samples (Alfalah credit, Alfalah debit card, UBL Raast, Jazz) with pkg `com.google.android.apps.messaging` gives false.
    - `plainOtps`: `"Your OTP is 482913. Do not share it."` and `"123456 is your verification code"` give true.
    - `otpNamingAnAmountIsStillOtp`: `"OTP 123456 for PKR 25,000 at Daraz"` gives true.
    - `transactionWithPinWordIsNot`: `"PKR 1,500.00 charged to your card. Never share your PIN 0000 with anyone"` gives false.
    - `chatAppsExempt`: pkg `com.whatsapp`, `"code 4455"` gives false.
  - `SearchTextTest`:
    - `foldsHarakatAndYehKaf`: `normalize("كِتابي") == normalize("کتابی")`.
    - `lowercasesLatin`: `normalize("Bank ALFALAH") == "bank alfalah"`.
    - `likeTermsEscapesWildcards`: `likeTerms("50% off_now \\x")` equals `listOf("%50\\%%", "%off\\_now%", "%\\\\x%")` (Kotlin string literals; the escaped forms are `50\%`, `off\_now`, `\\x`).
    - `likeTermsCapsAtEight`: a 10-word query gives 8 terms.
- [ ] **Step 2: Run the Gradle tests.** Expect FAIL.
- [ ] **Step 3: Implement** both objects.
- [ ] **Step 4: Run the Gradle tests.** Expect PASS.
- [ ] **Step 5: Commit** with the message `Inflow: OTP detection and search normalisation`.

### Task 4: Ingest, retention and the store contract (pure Kotlin)

**Files:**
- Create: `core/ItemStore.kt`, `core/Retention.kt`, `core/Ingest.kt`
- Test: `core/MemoryItemStore.kt` (test fake), `core/IngestTest.kt`

**Interfaces:**
- Consumes: `RawNotification`, `Capture`, `NotificationParser.parse`, `OtpDetector.isOtp`, `SearchText.normalize`.
- Produces:
  ```kotlin
  data class AppSetting(val pkg: String, val label: String, val record: Boolean, val keepDays: Int?)  // null = forever
  interface ItemStore {
    fun appSetting(pkg: String): AppSetting?
    fun putAppSetting(s: AppSetting)
    /** False when the hash is already saved or tombstoned. */
    fun insert(c: Capture, search: String, otpExpiresAt: Long?): Boolean
    /** Marks the saved message with this identity; false if none. */
    fun markDeletedBySender(pkg: String, conversationKey: String?, sender: String?, postedAt: Long): Boolean
    fun purgeExpiredOtps(now: Long): Int          // deletes and tombstones
    fun purgeOlder(pkg: String, cutoff: Long): Int
    fun deleteApp(pkg: String): Int
    fun allAppSettings(): List<AppSetting>
    fun meta(key: String): String?
    fun setMeta(key: String, value: String)
  }
  object Retention {
    const val STRONGROOM = "com.haroon.strongroom"
    val KEEP_FOREVER: Set<String>          // the 8 packages in Global Constraints
    val CHOICES: List<Int?>                // [null, 365, 90, 30]
    fun default(pkg: String, label: String): AppSetting   // record = pkg != STRONGROOM; keepDays = null if KEEP_FOREVER else 90
  }
  class Ingest(private val store: ItemStore, private val ownPkg: String, private val now: () -> Long) {
    fun onNotification(raw: RawNotification): Int      // items newly saved
    fun housekeeping()                                  // OTP purge always; retention purge at most once per 24 h (meta "lastRetentionAt")
    companion object { const val OTP_TTL_MS = 5 * 60_000L; const val DAY_MS = 86_400_000L }
  }
  ```
  `onNotification` saves an `AppSetting` from `Retention.default` the first time it sees a pkg. It returns 0 if `record` is false. For each capture: a `deletedPlaceholder` capture calls `markDeletedBySender` and is never inserted. Any other capture is inserted with `search = SearchText.normalize(listOfNotNull(sender, conversation, title, text).joinToString(" "))` and with `otpExpiresAt = now() + OTP_TTL_MS` when `OtpDetector.isOtp(pkg, text)`. It then calls `housekeeping()`.

- [ ] **Step 1: Write `MemoryItemStore`** (a map by hash plus a tombstone set, and the `otpExpiresAt` per item) and these failing tests in `IngestTest`:
  - `repostedHistorySavesEachMessageOnce`: a MessagingStyle raw with 3 messages, then the same conversation with those 3 plus a 4th, gives 3 and then 1.
  - `sameKeySameTextIsOneItem`: a non-messaging raw ingested twice gives 1 and then 0.
  - `recordOffSavesNothing`: after `putAppSetting(record=false)`, ingest gives 0.
  - `strongroomOffByDefault`: a raw from `com.haroon.strongroom` gives 0, and `appSetting` shows `record == false`.
  - `defaultsKeepForever`: first sight of `com.whatsapp` gives `keepDays == null`, and of `com.daraz.android` gives 90.
  - `otpPurgedAndTombstoned`: an OTP raw is inserted; advance the clock by 5 min + 1 ms and call `housekeeping`; the item is gone; ingesting the same raw again gives 0.
  - `deletedBySenderKeepsOriginal`: ingest message M, then a raw where M's slot (same sender and time) reads "This message was deleted". The original text is unchanged and marked deleted, and the item count is unchanged.
  - `retentionRunsOncePerDay`: a 90-day app with an item 91 days old; `housekeeping` purges it; a second item made 91 days old 1 h later is still there after another `housekeeping` call; it is purged after the clock moves 24 h on.
- [ ] **Step 2: Run the Gradle tests.** Expect FAIL.
- [ ] **Step 3: Implement** `ItemStore.kt`, `Retention.kt` and `Ingest.kt`.
- [ ] **Step 4: Run the Gradle tests.** Expect PASS.
- [ ] **Step 5: Commit** with the message `Inflow: ingest, OTP expiry, retention`.

### Task 5: Encrypted database

**Files:**
- Create: `core/OpenPlan.kt`, `android/DbKey.kt`, `android/SqlItemStore.kt`
- Test: `core/OpenPlanTest.kt`

**Interfaces:**
- Consumes: `ItemStore`, `AppSetting`, `Capture`, `SearchText.likeTerms`.
- Produces:
  ```kotlin
  sealed interface OpenPlan { object CreateNew : OpenPlan; object Open : OpenPlan; data class Fail(val message: String) : OpenPlan }
  fun openPlan(dbExists: Boolean, wrappedKeyPresent: Boolean): OpenPlan
  object DbKey { fun get(context: Context, create: Boolean): ByteArray? }   // 32 random bytes, wrapped with Keystore AES-GCM alias "inflow-db", no user auth, prefs "inflow-key"
  class SqlItemStore private constructor(...) : ItemStore {
    companion object { fun open(context: Context): Result<SqlItemStore> }  // failure carries OpenPlan.Fail.message
    // queries used by the module (Task 6):
    fun home(startOfDay: Long, now: Long): Map<String, Any>               // { conversations, apps }, matching the TS HomeSummary
    fun list(filter: Map<String, Any?>, before: Long?, limit: Int, now: Long): List<Map<String, Any?>>  // TS Item rows
    fun rename(senderKey: String, name: String?)
    fun senderNames(): List<Map<String, String>>
  }
  ```
  `openPlan`: no db and no key gives `CreateNew`; both present gives `Open`; a key with no db gives `CreateNew` (a fresh install that kept prefs). **A db with no key gives `Fail("Inflow can't open your saved history because this phone no longer has its key. The history file is kept, not deleted.")`.** Never delete or replace the file.

  Schema (version 1, `inflow.db`, SQLCipher with the raw 32-byte key):
  ```sql
  CREATE TABLE items(id INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, pkg TEXT NOT NULL, app_label TEXT NOT NULL,
    sender TEXT, sender_key TEXT, conversation TEXT, conversation_key TEXT, title TEXT, text TEXT NOT NULL,
    posted_at INTEGER NOT NULL, captured_at INTEGER NOT NULL, otp_expires_at INTEGER, deleted_by_sender INTEGER NOT NULL DEFAULT 0,
    search TEXT NOT NULL);
  CREATE INDEX items_posted ON items(posted_at DESC);
  CREATE INDEX items_pkg ON items(pkg, posted_at DESC);
  CREATE INDEX items_conv ON items(conversation_key, posted_at DESC);
  CREATE INDEX items_otp ON items(otp_expires_at) WHERE otp_expires_at IS NOT NULL;
  CREATE TABLE apps(pkg TEXT PRIMARY KEY, label TEXT NOT NULL, record INTEGER NOT NULL, keep_days INTEGER);
  CREATE TABLE sender_names(sender_key TEXT PRIMARY KEY, sender TEXT NOT NULL, name TEXT NOT NULL);
  CREATE TABLE tombstones(hash TEXT PRIMARY KEY, at INTEGER NOT NULL);
  CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
  ```
  Every read adds `(otp_expires_at IS NULL OR otp_expires_at > :now)`. The display name is `COALESCE(sender_names.name, items.sender)`, joined on `sender_key`. A conversation row's name is `COALESCE(name for conversation_key, conversation)`. The `sender` filter matches on the display name, so several renamed senders show as one. `search` filter: `AND search LIKE ? ESCAPE '\'` per term from `likeTerms`. Paging: `posted_at < before ORDER BY posted_at DESC LIMIT limit`. Home: the 5 conversations and the 8 apps with the latest `posted_at`, each with its count of items since `startOfDay`.
  `// shortcut: LIKE scans every row; switch to FTS5 if search passes ~300 ms on the phone.`

- [ ] **Step 1: Write failing `OpenPlanTest`** covering the four combinations. The Fail case asserts that the message contains "kept".
- [ ] **Step 2: Run the Gradle tests.** Expect FAIL.
- [ ] **Step 3: Implement** `openPlan`, `DbKey` (model it on `apps/deputy/.../android/KeyVault.kt`'s Keystore AES-GCM code) and `SqlItemStore` with the schema and queries above, using `net.zetetic.database.sqlcipher.SQLiteDatabase` and `System.loadLibrary("sqlcipher")`.
- [ ] **Step 4: Run the compile gate** (`:inflow-core:testDebugUnitTest :app:assembleDebug`). Expect tests PASS and BUILD SUCCESSFUL. SQL is proved on a device in Task 9; there is no JVM SQLCipher.
- [ ] **Step 5: Commit** with the message `Inflow: encrypted store`.

### Task 6: Listener, lock and the native module API

**Files:**
- Create: `android/RawFromSbn.kt`, `android/InflowListener.kt`, `android/Lock.kt`
- Modify: `InflowCoreModule.kt`, `modules/inflow-core/android/src/main/AndroidManifest.xml`

**Interfaces:**
- Consumes: `Ingest`, `SqlItemStore`, `Retention`.
- Produces: the module functions behind the TS contract in Task 7 (same names, same shapes), plus the event `"onCaptured"` with `{ count: Int }`.

- [ ] **Step 1: Write `RawFromSbn.from(sbn, appLabel): RawNotification`.** Read `EXTRA_TITLE`, `EXTRA_TEXT`, `EXTRA_BIG_TEXT`, `EXTRA_SUB_TEXT`, `EXTRA_TEXT_LINES`, `EXTRA_CONVERSATION_TITLE` and `EXTRA_IS_GROUP_CONVERSATION`, and the messages through `NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification` (sender `person?.name`). Read `ongoing` from `FLAG_ONGOING_EVENT` or `FLAG_FOREGROUND_SERVICE`, and `groupSummary` from `FLAG_GROUP_SUMMARY`. Every CharSequence goes through `toString()`.
- [ ] **Step 2: Write `InflowListener : NotificationListenerService`.** `onNotificationPosted` runs `Ingest.onNotification` off the main thread (a single-thread executor) and, when the count is above 0, sends `onCaptured`. It records meta `lastCaptureAt`. `onListenerConnected` and `onListenerDisconnected` set a process-wide `connected` flag. On disconnect it calls `requestRebind(ComponentName(...))`. Declare the service in the module manifest with `android.permission.BIND_NOTIFICATION_LISTENER_SERVICE` and the `android.service.notification.NotificationListenerService` intent filter. If the store fails to open, the listener drops the notification and records nothing. Log the reason with `Log.w` only, never the text.
- [ ] **Step 3: Write `Lock.authenticate(activity: FragmentActivity): suspend -> Pair<Boolean, String?>`.** Use `BiometricPrompt` with `BIOMETRIC_STRONG or DEVICE_CREDENTIAL`, title "Unlock Inflow", and `null` on success. Errors map to plain messages: no enrolment gives "Set up a fingerprint or screen lock in phone settings, then try again."; a cancel gives null message and `false`.
- [ ] **Step 4: Fill the module.** `getStatus`, `openNotificationAccess` (`Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS`), `openAppInfo`, `openBatterySettings`, `reconnect` (`requestRebind`), `authenticate` (AsyncFunction, Coroutine), `home`, `listItems`, `listApps`, `setRecord(pkg, record, deleteSaved)` (`deleteSaved` calls `deleteApp`), `setKeep`, `renameSender` (a blank name removes the rename), `listSenderNames`. `home` first runs `Ingest.housekeeping()`, so expired OTPs and old items are purged even on days with no new notifications. `accessGranted` comes from `NotificationManagerCompat.getEnabledListenerPackages(context).contains(packageName)`, and `batteryUnrestricted` from `PowerManager.isIgnoringBatteryOptimizations`. `storeError` is the `OpenPlan.Fail` message or null.
- [ ] **Step 5: Run the compile gate.** Expect PASS and BUILD SUCCESSFUL.
- [ ] **Step 6: Commit** with the message `Inflow: notification listener, lock, module API`.

### Task 7: TS contract and pure UI helpers

**Files:**
- Modify: `modules/inflow-core/src/index.ts`
- Create: `apps/inflow/src/{setup.ts,health.ts,format.ts}`, `apps/inflow/src/__tests__/{setup,health,format}.test.ts`
- Modify: `apps/inflow/package.json` (`test` lists the three new files)

**Interfaces:**
- Produces (`inflow-core`):
  ```ts
  export interface Status { accessGranted: boolean; listenerConnected: boolean; lastCaptureAt: number | null; batteryUnrestricted: boolean; storeError: string | null }
  export interface Item { id: number; pkg: string; appLabel: string; sender: string | null; senderKey: string | null; displayName: string | null; conversation: string | null; conversationKey: string | null; title: string | null; text: string; postedAt: number; deletedBySender: boolean }
  export type ItemFilter = { kind: 'all' } | { kind: 'app'; pkg: string } | { kind: 'conversation'; key: string } | { kind: 'sender'; name: string } | { kind: 'search'; query: string };
  export interface ConversationRow { key: string; pkg: string; appLabel: string; name: string; lastText: string; lastAt: number; today: number }
  export interface AppRow { pkg: string; label: string; lastAt: number; today: number }
  export interface HomeSummary { conversations: ConversationRow[]; apps: AppRow[] }
  export interface AppSetting { pkg: string; label: string; record: boolean; keepDays: number | null }
  export interface SenderName { senderKey: string; sender: string; name: string }
  // default export: { getStatus, openNotificationAccess, openAppInfo, openBatterySettings, reconnect,
  //   authenticate(): Promise<{ ok: boolean; message: string | null }>, home(startOfDay: number): HomeSummary,
  //   listItems(filter: ItemFilter, before: number | null, limit: number): Item[], listApps(): AppSetting[],
  //   setRecord(pkg: string, record: boolean, deleteSaved: boolean): void, setKeep(pkg: string, days: number | null): void,
  //   renameSender(senderKey: string, name: string | null): void, listSenderNames(): SenderName[] }
  export function addCapturedListener(cb: () => void): { remove(): void }
  ```
- Produces (app):
  ```ts
  export interface SetupRow { id: 'access' | 'restricted' | 'battery' | 'autostart'; title: string; detail: string; status: 'ok' | 'todo' | 'manual'; action: 'access' | 'appInfo' | 'battery' }
  export function setupRows(s: Status): SetupRow[]
  export const setupComplete: (rows: SetupRow[]) => boolean          // no 'todo' rows
  export interface HealthNotice { tone: 'danger' | 'warn'; title: string; body: string; action: 'access' | 'reconnect' | null }
  export function healthNotice(s: Status, now: number): HealthNotice | null
  export function whenLabel(at: number, now: number): string         // "12:02", "Yesterday", "12 Nov", "12 Nov 2025"
  export function keepLabel(days: number | null): string              // "Forever", "1 year", "90 days", "30 days"
  ```
  Model `setup.ts` on `apps/deputy/src/setup.ts`. Its rows: notification access (live), allow restricted settings (manual, App info), battery no restrictions (live), Autostart on Xiaomi phones (manual, App info).

- [ ] **Step 1: Write failing tests.**
  - `health.test.ts`: if `storeError` is set, it gives `danger`, the error as the body and `action` null, ahead of everything else. If access is off, it gives `danger` with title "Inflow isn't saving notifications" and `action 'access'`. If access is on and the listener is disconnected, it gives `warn` with `action 'reconnect'`. If all is well, it gives `null`.
  - `setup.test.ts`: access off gives the `access` row as `todo` and `setupComplete` false. Access and battery on gives `setupComplete` true; the manual rows don't block.
  - `format.test.ts`: for `whenLabel`, the same day gives `HH:mm`, the previous day "Yesterday", the same year `d MMM`, and older `d MMM yyyy`. `keepLabel(null) === 'Forever'` and `keepLabel(365) === '1 year'`. Use fixed timestamps with `TZ=Asia/Karachi` set in the test script (`TZ=Asia/Karachi node --test …`).
- [ ] **Step 2: Run `pnpm --filter inflow test`.** Expect FAIL.
- [ ] **Step 3: Implement** the contract (`requireNativeModule('InflowCore')`, events through `EventEmitter`, following `apps/strongroom/modules/strongroom-vault/src/index.ts`) and the three helpers.
- [ ] **Step 4: Run `pnpm --filter inflow test` and `pnpm --filter inflow typecheck`.** Expect PASS and no errors.
- [ ] **Step 5: Commit** with the message `Inflow: TS contract and UI helpers`.

### Task 8: Screens

**Files:**
- Create: `apps/inflow/src/{LockScreen,SetupScreen,HomeScreen,ListScreen,ItemSheet,RenameSheet,SettingsScreen}.tsx`
- Modify: `apps/inflow/App.tsx`

**Interfaces:**
- Consumes: everything in Task 7.

Behaviour (stage 1 scope of the spec's "Screens"):
- **App:** starts locked. `AppState` going to `background` locks again. While locked, only `LockScreen` renders: it calls `authenticate()` on mount and has an "Unlock" button. If `setupComplete(setupRows(status))` is false, it shows `SetupScreen` first. Otherwise it shows tabs `Home` and `Settings` (`TabBar`); Money and Ask AI arrive in later stages, so they are not shown. Routes stack over the tabs: list (with an `ItemFilter` and a title), then back.
- **Home:** a `healthNotice` as a `Notice` with its action button. A search `Field` that opens the list with `{kind:'search'}` on submit. A Money `Group` holding a single muted row "Bank SMS and spending arrive in the next update". A Messages `Group` with conversation rows (name, last text one line, `whenLabel`, "N today") that open `{kind:'conversation'}`, plus "See all" opening `{kind:'all'}`. An Apps `Group` with app rows that open `{kind:'app'}`. It refreshes on `addCapturedListener` and on pull-to-refresh. The empty state (nothing saved yet) says "New notifications will appear here as they arrive. Inflow can't read ones that came before it was set up."
- **List:** newest first, loads 50 more at the end (`before` = last `postedAt`). A row shows display name or app label, title when it differs from the sender, text (3 lines), app label and `whenLabel`, and a "Deleted by sender" `Pill` when flagged. Tapping a row opens `ItemSheet`.
- **ItemSheet:** the full text (selectable), app, sender, conversation, exact date and time, plus "Rename sender" (shown when `senderKey` is set) and "Show everything from this sender" (opens `{kind:'sender', name: displayName}`).
- **RenameSheet:** a name `Field` prefilled with the current name, with existing names from `listSenderNames()` offered as tappable choices so several numbers can share one name. Save calls `renameSender`. "Remove name" calls it with null.
- **Settings:** an Apps `Group` from `listApps()` where each row has a record switch (`Segmented` On/Off) and a keep-for `Segmented` (Forever, 1 year, 90 days, 30 days). Switching recording off opens a `Sheet`: "Stop saving <app>? Also delete the N items already saved?" with "Stop and delete" and "Stop, keep saved items". Below that: a Renamed senders `Group`, a Setup `Group` (the setup rows), and a Lock `Notice` reading "Your fingerprint locks these screens. Your history is encrypted with a key this phone keeps, so Inflow can keep saving notifications while it's locked."

- [ ] **Step 1: Build the screens and wire App.tsx.**
- [ ] **Step 2: Run `pnpm --filter inflow typecheck` and `pnpm --filter inflow test`.** Expect no errors and PASS.
- [ ] **Step 3: Run the compile gate.** Expect BUILD SUCCESSFUL.
- [ ] **Step 4: Commit** with the message `Inflow: lock, setup, home, lists, rename, settings`.

### Task 9: Verify, release, phone check, handoff

**Files:**
- Modify: `docs/handoffs/inflow.md` (session log, state, next step: stage 2 plan)

- [ ] **Step 1: Run the full gates** from the repo root and report the actual output: `pnpm test`, `pnpm typecheck`, `pnpm --filter inflow exec expo-doctor` (or `pnpm doctor`), and the Inflow compile gate. Then dispatch `code-reviewer` and `invariant-reviewer` on the branch diff, and fix what they confirm.
- [ ] **Step 2: Ask the owner for the go to release.** On a yes, follow their release memory (merge per their process, then `pnpm release inflow` locally). Never adb-install.
- [ ] **Step 3: Phone check, owner present.** Claim `device:<serial>` with coord first. Install from the Store, then check:
  1. Setup walks through notification access. If that switch is greyed out, check that "Allow restricted settings" in App info unlocks it, and note whether the Store install needed it (this informs stage 2's SMS permission check).
  2. A WhatsApp message and a group message appear under Messages, grouped correctly. A second message adds exactly one item.
  3. A bank or Jazz SMS appears with its full text.
  4. An OTP SMS shows, then is gone after 5 minutes, and doesn't come back after the app restarts.
  5. Renaming a short code to "Bank Alfalah" changes old and new items. Giving a second number the same name merges them in "Show everything from this sender".
  6. Recording off for one app: new notifications from it aren't saved, and "Stop and delete" removes old ones.
  7. Sending Inflow to the background and reopening asks for the fingerprint.
  8. Swiping Inflow out of recents, then getting a notification: it's still saved. If it isn't, the Home warning appears.
  9. Search finds an Urdu word typed without harakat, and `50%` matches only a literal "50%".
  Release the device claim when done.
- [ ] **Step 4: Update the handoff.** Record the release version, the phone check results (copy the actual observations), and set the next step to: ask the owner about the stage 2 open item if any, then write the stage 2 plan.
- [ ] **Step 5: Commit** with the message `Inflow stage 1: handoff`.
