# Strongroom Phase 1 (Android local vault) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Android app, `com.haroon.strongroom`, that keeps logins, cards and notes in an encrypted local vault. It fills and saves passwords in apps and in Chrome through the Android autofill framework, and imports a Google Password Manager export.

**Architecture:** One Expo app, `apps/strongroom`, and one Expo local module, `strongroom-vault`. Kotlin owns everything that touches secrets. `core/` is pure Kotlin (JVM unit-tested): crypto, vault format, matching, import and form detection. `android/` holds the platform adapters: SQLite, Keystore, the autofill service and the unlock activity. React Native only renders screens and gets rows without passwords.

**Tech Stack:** Expo SDK 54, RN 0.81.5, TS 5.9, Kotlin. Libraries: BouncyCastle `bcprov-jdk18on` (Argon2id, HKDF), `androidx.biometric`, `androidx.autofill` (inline suggestions), Mozilla's `public_suffix_list.dat` (MPL-2.0, vendored as a resource), `kotlinx-serialization-json` (JsonElement API, no compiler plugin, as Deputy uses it).

**Spec:** `docs/strongroom/DESIGN.md` (read it first; § numbers below refer to it). Handoff: `docs/handoffs/strongroom.md`.

## Global Constraints

- Package `com.haroon.strongroom`; app dir `apps/strongroom`; module `apps/strongroom/modules/strongroom-vault`; Kotlin packages `expo.modules.strongroomvault.core` (pure) and `expo.modules.strongroomvault.android` (platform).
- `minSdk 33` (`android.minSdkVersion=33` in `apps/strongroom/android/gradle.properties`); `allowBackup: false`; Android only, no `ios/`.
- UI only from `@apps-hub/ui`, `<ThemeProvider brand="strongroom">`. Copy is sentence case, active voice, no emoji, no ALL CAPS; errors say what happened and how to fix it.
- No telemetry, no proprietary dependencies. Add dependencies with the `upgrading-dependencies` skill.
- Crypto exactly as §6: Argon2id (start m = 65536 KiB, t = 3, p = 1, 16-byte salt; refused below `KdfParams.FLOOR` or above the ceiling), HKDF-SHA-256 with empty salt, AES-256-GCM (12-byte random nonce, 128-bit tag, sealed bytes = `nonce ‖ ciphertext ‖ tag`). No other primitives. No function in main code takes a nonce; fixed-nonce encryption exists only in test sources.
- No OkHttp or other network library in the module. Phase 1 has no network code: `INTERNET` exists only in the debug build (Metro), and the release APK must not hold it (Task 12 checks).
- Every activity (`MainActivity`, `UnlockActivity`): `FLAG_SECURE`; `window.setHideOverlayWindows(true)` (`HIDE_OVERLAY_WINDOWS` permission); root view `setAccessibilityDataSensitive(ACCESSIBILITY_DATA_SENSITIVE_YES)` on API 34+ (`importantForAccessibility` alone doesn't hide views from services that request not-important views; it stays only as the API 33 fallback on a shown password, Task 11); content view `IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS`.
- Secrets never cross to JS except: the master password and recovery key the owner types, a password after Show, and the entry being edited.
- Install on the phone only through the Store (`pnpm release strongroom`, release builds only), never `adb install`. Debug runs use an emulator (Google APIs image with Chrome): `pnpm --filter strongroom android`.
- Phase 1 is testing only. Google stays the everyday autofill service (§3).
- Gradle: `cd apps/strongroom/android && JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew …`; JVM tests are `:strongroom-vault:testDebugUnitTest`.
- Work on branch `strongroom-phase-1`. Commit after each task (message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Never push or release without the owner's word.

## Review Focus

1. **A master password with non-ASCII characters** (Urdu, accents, emoji) must unlock on every platform. Normalize to NFC before UTF-8 encoding. Pinned in Task 3.
2. **One record that won't decrypt** (corrupt or truncated) must not stop the vault opening or delete anything. The others list, and the bad one is counted and reported. Pinned in Task 5.
3. **A real Google export** starts with a UTF-8 BOM and uses CRLF line endings, has empty usernames, and has URLs without a path. The import must still parse it. Pinned in Task 7.
4. **Hosts that differ only in case, a trailing dot or IDN encoding** (`Example.COM.`, `bücher.de` vs `xn--bcher-kva.de`) are the same site. Pinned in Task 6.
5. **A Keystore key that has gone** (new fingerprint enrolled, screen lock removed, app data restored) must fall back to the master password and rebuild the match index, not crash or lose saves. Pinned in Tasks 6 and 9.

---

### Task 1: Threat-model review (gate before any code)

**Files:**
- Modify: `docs/strongroom/DESIGN.md` (fold in accepted findings)
- Modify: `docs/handoffs/strongroom.md` (record findings and decisions)

- [ ] **Step 1:** Dispatch the `security-engineer` agent to threat-model §6, §7 and §10 of `docs/strongroom/DESIGN.md`. Ask specifically about: the match index (Keystore key with no user auth), pending saves while locked, the browser allowlist, the HKDF labels and AAD choices, recovery-key strength, and autofill authentication intents.
- [ ] **Step 2:** Sort the findings. A finding that changes what gets built goes to the owner in one message. Anything else is fixed directly in DESIGN.md, marked as the reviewer's point.
- [ ] **Step 3:** If a finding changes an interface in this plan, update the affected task's Interfaces block before Task 2 starts.
- [ ] **Step 4:** Commit: `docs: Strongroom threat-model review folded into the design`.

### Task 2: Scaffold the app, module, brand and release wiring

**Files:**
- Create: `apps/strongroom/{package.json,app.json,index.ts,App.tsx,metro.config.js,tsconfig.json}` (copy Deputy's shape; `App.tsx` shows a `Screen` with `Header title="Strongroom"` only)
- Create: `apps/strongroom/android/**` via `expo prebuild --platform android`, then apply Deputy's edits: release `signingConfigs` reading `APPS_HUB_RELEASE_*` (`apps/deputy/android/app/build.gradle:101-124`), `android.minSdkVersion=33`
- Create: `apps/strongroom/android/app/src/release/AndroidManifest.xml` (`<uses-permission android:name="android.permission.INTERNET" tools:node="remove"/>`, so the release build drops it even when a library merges it in; debug keeps it for Metro)
- Create: `apps/strongroom/assets/icon.svg` (needs `<rect id="plate" rx="228">` and `<g id="mark">`: a vault-door mark), then run `node tools/icons/render-icon.mjs apps/strongroom/assets/icon.svg apps/strongroom`
- Create: `apps/strongroom/modules/strongroom-vault/{package.json,expo-module.config.json,src/index.ts}`, `android/build.gradle`, `android/src/main/AndroidManifest.xml`, `android/src/main/java/expo/modules/strongroomvault/StrongroomVaultModule.kt`
- Modify: `packages/ui/src/tokens.ts` (`BrandKey` + `brands.strongroom`), then `pnpm --filter @apps-hub/ui build:css`
- Modify: `tools/release/src/apps.ts` (add `strongroom: { name: 'Strongroom', dir: 'apps/strongroom', android: { packageName: 'com.haroon.strongroom' } }`)
- Modify: `apps/store/modules/store-installer/android/src/main/AndroidManifest.xml` (add `<package android:name="com.haroon.strongroom" />` next to Deputy's)
- Modify: `.gitignore` (the seven Deputy lines, for `apps/strongroom`)
- Modify: `AGENTS.md` (app list entry; Gradle gate `:strongroom-vault:testDebugUnitTest :app:assembleDebug` under Verification Commands)

**Interfaces:**
- Produces: a native module named `StrongroomVault` with `Function("ping") { "ok" }`, and TS default export `StrongroomVault` from `strongroom-vault` (`requireNativeModule('StrongroomVault')`).
- Produces: `build.gradle` dependencies, used from Task 3 on: `org.bouncycastle:bcprov-jdk18on`, `androidx.biometric:biometric`, `androidx.autofill:autofill`, `org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1`, test `junit:junit:4.13.2`. No OkHttp. Pick the latest stable versions the toolchain accepts and record them in the commit.

- [ ] **Step 1:** Add the brand: hue 300, accent `{ dark: '#E879F9', light: '#A21CAF' }`, onAccent `{ dark: '#2A0530', light: '#FFFFFF' }`, comment "Provisional until the launcher icon is final", then rebuild the CSS.
- [ ] **Step 2:** Run `pnpm --filter @apps-hub/ui test`. Expected: PASS. The tokens test enforces AA contrast for the new brand. If it fails, adjust the accent lightness and re-run.
- [ ] **Step 3:** Scaffold the app and module as listed. `app.json`: `"platforms": ["android"]`, `"package": "com.haroon.strongroom"`, `"allowBackup": false`, `"userInterfaceStyle": "automatic"`, `"blockedPermissions"` as Deputy's. Phase 1 has no network code. INTERNET stays only in debug builds, which load JS from Metro; the release manifest above removes it.
- [ ] **Step 4:** Run `pnpm install && pnpm typecheck`. Expected: no errors.
- [ ] **Step 5:** Run the Gradle gate `:strongroom-vault:testDebugUnitTest :app:assembleDebug`. Expected: `BUILD SUCCESSFUL`.
- [ ] **Step 6:** Commit: `Strongroom: scaffold app, vault module, brand and release wiring`.

### Task 3: Crypto primitives and the recovery key

**Files:**
- Create: `…/strongroomvault/core/Crypto.kt`, `…/core/RecoveryKey.kt`
- Test: `apps/strongroom/modules/strongroom-vault/android/src/test/java/expo/modules/strongroomvault/core/CryptoTest.kt`, `RecoveryKeyTest.kt`

**Interfaces:**
- Produces:
  - `data class KdfParams(val memoryKiB: Int, val iterations: Int, val parallelism: Int) { fun inRange(): Boolean; companion object { val DEFAULT = KdfParams(65536, 3, 1); val FLOOR = KdfParams(32768, 2, 1); const val MAX_MEMORY_KIB = 1048576; internal var testFloor: KdfParams? = null } }`. `inRange()` is every field ≥ `testFloor ?: FLOOR` and `memoryKiB ≤ MAX_MEMORY_KIB`. Only tests set `testFloor` (to `KdfParams(1024, 1, 1)`, for speed); main code never does.
  - `object Crypto { fun passwordBytes(password: CharArray): ByteArray` (NFC, then UTF-8) `; fun argon2id(password: CharArray, salt: ByteArray, p: KdfParams): ByteArray` (32 bytes) `; fun hkdf(ikm: ByteArray, info: String, length: Int = 32): ByteArray; fun seal(key: ByteArray, plaintext: ByteArray, aad: ByteArray): ByteArray` (always a fresh random nonce; no overload in main code takes a nonce) `; fun open(key: ByteArray, sealed: ByteArray, aad: ByteArray): ByteArray?` (null on any auth or length failure) `; fun randomBytes(n: Int): ByteArray` (`SecureRandom`) `}`
  - `object RecoveryKey { fun generate(): ByteArray` (20 bytes) `; fun format(bytes: ByteArray): String` (RFC 4648 base32, no padding, 8 groups of 4 joined by `-`) `; fun parse(text: String): ByteArray?` (ignores case, spaces and dashes; null unless exactly 32 base32 chars) `; fun group(formatted: String, index: Int): String }`

- [ ] **Step 1: Write the failing tests**

```kotlin
// CryptoTest.kt
@Test fun argon2idMatchesRfc9106Vector()   // RFC 9106 §5.3 inputs via BouncyCastle directly; copy the expected tag from the RFC text, never from memory
@Test fun hkdfMatchesRfc5869Case1()        // RFC 5869 A.1 (that case uses a salt: add an internal overload hkdf(ikm, salt, info, len) for this test only)
@Test fun aesGcmMatchesNistVector()        // one NIST/McGrew–Viega AES-256-GCM case with AAD, from the published text: open() its nonce‖ct‖tag and compare the plaintext
@Test fun kdfFloorAndCeiling()             // sets testFloor = null first: (32768,2,1) inRange; (32767,2,1), (32768,1,1), (32768,2,0), (1048577,2,1) not
@Test fun sealOpenRoundTrip()              // open(k, seal(k, p, aad), aad) contentEquals p
@Test fun openRejectsTamperedByte()        // flip any byte of sealed → null
@Test fun openRejectsWrongAad()            // different aad → null
@Test fun openRejectsShortInput()          // ByteArray(10) → null, no exception
@Test fun nfcAndNfdPasswordsDeriveSameKey()// "passwörd" vs "passwörd" with KdfParams(1024,1,1): argon2id outputs equal
// RecoveryKeyTest.kt
@Test fun formatIsEightGroupsOfFour()      // matches Regex("^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$")
@Test fun parseRoundTripsAndIsTolerant()   // parse(format(b).lowercase().replace("-", " ")) contentEquals b
@Test fun parseRejectsWrongLength()        // parse("ABCD-EFGH") == null; a key containing '1' or '8' → null
```

- [ ] **Step 2:** Run `./gradlew :strongroom-vault:testDebugUnitTest --tests '*CryptoTest' --tests '*RecoveryKeyTest'`. Expected: FAIL (unresolved references).
- [ ] **Step 3:** Implement. Argon2 through `org.bouncycastle.crypto.generators.Argon2BytesGenerator` (version 1.3); HKDF through `HKDFBytesGenerator(SHA256Digest())` with `HKDFParameters(ikm, null, info.toByteArray())`; AES through `javax.crypto` `AES/GCM/NoPadding`. Zero the intermediate password bytes after use.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `Strongroom: crypto primitives and recovery key`.

### Task 4: Vault format, entries and shared test vectors

**Files:**
- Create: `…/core/Entry.kt`, `…/core/VaultFormat.kt`
- Create: `apps/strongroom/modules/strongroom-vault/android/src/test/resources/vault-vectors.json` (Phase 3's TS tests read this same file)
- Test: `…/core/VaultFormatTest.kt`, `…/core/EntryJsonTest.kt`

**Interfaces:**
- Consumes: `Crypto`, `KdfParams`, `RecoveryKey` (Task 3).
- Produces:
  - `data class Site(val https: Boolean, val host: String)`; `data class AppId(val pkg: String, val certSha256: String)` (lowercase hex; `init` requires 64 hex chars, so an empty or broken digest can't exist)
  - `data class AppLink(val app: AppId, val domain: String?)`: `domain` is the registrable domain (else the normalized host) of the `webDomain` a non-browser app reported when the link or save was made there, null for the app's own screens (and for imported `android://` entries)
  - `sealed interface Entry { val updatedAt: Long }` with `data class Login(val name: String, val username: String, val password: String, val sites: List<Site>, val apps: List<AppLink>, val note: String, override val updatedAt: Long)`, `data class Card(val name: String, val holder: String, val number: String, val expMonth: Int?, val expYear: Int?, val cvc: String, val note: String, override val updatedAt: Long)`, `data class Note(val name: String, val text: String, override val updatedAt: Long)`, `data class Deleted(override val updatedAt: Long)`
  - `object EntryJson { fun encode(e: Entry): String; fun decode(s: String): Entry? }` (null on malformed). JSON field `type` is `login | card | note | deleted`.
  - `data class Header(val version: Int, val kdf: KdfParams, val salt: ByteArray, val passwordWrap: ByteArray, val recoveryWrap: ByteArray) { fun toJson(): String; companion object { fun fromJson(s: String): Header? } }` (byte fields are standard Base64 with padding)
  - `class KdfOutOfRange(val kdf: KdfParams) : Exception("KDF parameters out of range")`
  - `object VaultFormat { const val VERSION = 1; fun create(password: CharArray, recoveryKey: ByteArray, kdf: KdfParams = KdfParams.DEFAULT): Pair<Header, ByteArray>` (header, vaultKey) `; fun unlockWithPassword(h: Header, password: CharArray): ByteArray?` (null on a wrong password; throws `KdfOutOfRange` before deriving when `!h.kdf.inRange()`) `; fun unlockWithRecovery(h: Header, recoveryKey: ByteArray): ByteArray?; fun withNewPassword(h: Header, vaultKey: ByteArray, password: CharArray, kdf: KdfParams = h.kdf): Header` (new salt; throws `KdfOutOfRange` when `kdf` is out of range or any field is lower than `h.kdf`) `; fun withNewRecovery(h: Header, vaultKey: ByteArray, recoveryKey: ByteArray): Header; fun sealEntry(vaultKey: ByteArray, id: String, e: Entry): ByteArray; fun openEntry(vaultKey: ByteArray, id: String, sealed: ByteArray): Entry? }`
  - Labels: HKDF info `strongroom/v1/wrap`, `strongroom/v1/login` (Phase 2); AAD `strongroom/v1/password-wrap`, `strongroom/v1/recovery-wrap`, `strongroom/v1/record/<id>`.

- [ ] **Step 1: Write the failing tests**

```kotlin
@Test fun createThenUnlockWithPasswordReturnsSameVaultKey()
@Test fun wrongPasswordReturnsNull()
@Test fun recoveryKeyUnlocksAndNewPasswordWorksAfterwards() // withNewPassword → old password null, new one returns same vaultKey
@Test fun newRecoveryKeyRevokesOldOne()
@Test fun recordMovedToAnotherIdFailsToOpen()  // openEntry(k, "b", sealEntry(k, "a", e)) == null
@Test fun headerJsonRoundTrips()
@Test fun everyEntryTypeRoundTripsThroughJson()
@Test fun belowFloorHeaderRefusedBeforeDerivation() // sets testFloor = null first; header kdf (16,1,1) and (Int.MAX_VALUE,1,1) → assertThrows<KdfOutOfRange>, returns at once (deriving the second would run out of memory)
@Test fun paramsNeverDecrease()                // h built with KdfParams(2048,2,1); withNewPassword(h, k, pw, KdfParams(1024,2,1)) (in range, but lower) throws KdfOutOfRange; withNewPassword(h, k, pw).kdf == h.kdf
@Test fun vectorsFileStillMatches()            // recompute every derivation (masterKey, wrapKey, loginToken) and compare hex; open each fixed sealed blob (both wraps, one record per type) and compare the plaintext/entry
```

- [ ] **Step 2:** Run `--tests '*VaultFormatTest' --tests '*EntryJsonTest'`. Expected: FAIL.
- [ ] **Step 3:** Implement. The vault key is `Crypto.randomBytes(32)`; wraps use `hkdf(argon2id(...), "strongroom/v1/wrap")` and `hkdf(recoveryKey, "strongroom/v1/wrap")`. Tests use `KdfParams(1024, 1, 1)` for speed: set `KdfParams.testFloor = KdfParams(1024, 1, 1)` in `@Before` and clear it in `@After` (it is JVM-wide state).
- [ ] **Step 4:** Generate `vault-vectors.json` once with a test-source helper (`src/test/…/core/VectorGen.kt`, which encrypts with fixed nonces through `javax.crypto` directly), from fixed inputs: password `"correct horse battery staple"`, an NFD password, a 16-byte salt, a recovery key, a vault key, nonces, one entry of each type with ids (the login has one `AppLink` with a domain and one without), and `KdfParams(1024,1,1)`. Record every derivation (masterKey, wrapKey, loginToken) and every sealed blob (wraps, records) as hex. Check the file in. From then on `vectorsFileStillMatches` guards it.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Commit: `Strongroom: vault format, entries and shared test vectors`.

### Task 5: Vault session over a storage port, and the lock rules

**Files:**
- Create: `…/core/RecordStore.kt`, `…/core/Vault.kt`, `…/core/LockPolicy.kt`
- Test: `…/core/VaultTest.kt`, `…/core/LockPolicyTest.kt`, `…/core/MemoryRecordStore.kt` (test source)

**Interfaces:**
- Consumes: Task 3's `KdfParams`; Task 4's `VaultFormat`, `Entry`, `Header`, `KdfOutOfRange`.
- Produces:
  - `interface RecordStore { fun header(): String?; fun putHeader(json: String); fun all(): Map<String, ByteArray>; fun putAll(records: Map<String, ByteArray>) }` (`putAll` is one transaction)
  - `data class Row(val id: String, val type: String, val name: String, val subtitle: String)` (login: username; card: `•••• ` + last 4; note: empty)
  - `class Vault(store: RecordStore, clock: () -> Long, elapsed: () -> Long) { var autoLockMinutes: Int; val isSetUp: Boolean; val isUnlocked: Boolean; val unreadable: Int; fun setUp(password: CharArray, recoveryKey: ByteArray, kdf: KdfParams = KdfParams.DEFAULT); fun unlock(password: CharArray): Boolean; fun recover(recoveryKey: ByteArray, newPassword: CharArray): Boolean; fun unlockWithKey(vaultKey: ByteArray): Boolean; fun touch(); fun lock(); fun rows(): List<Row>; fun get(id: String): Entry?; fun all(): Map<String, Entry>; fun put(id: String?, e: Entry): String; fun delete(id: String); fun putMany(entries: List<Entry>): Int; fun changePassword(old: CharArray, new: CharArray): Boolean; fun newRecoveryKey(password: CharArray): ByteArray?; fun vaultKeyCopy(password: CharArray): ByteArray? }`. `clock` is wall time (for `updatedAt`); `elapsed` is `SystemClock.elapsedRealtime` in the app (counts deep sleep). Every access, `isUnlocked` included, first checks `LockPolicy.expired(lastUsedAt, elapsed(), autoLockMinutes)` and locks if so. Only `touch()` and the unlock calls move `lastUsedAt`; reads and writes don't. Locked calls throw `IllegalStateException("locked")`. `unlock` and `recover` let `KdfOutOfRange` propagate (a refused header is not a wrong password). `setUp` throws `IllegalStateException("already set up")` when a header exists. `newRecoveryKey` and `vaultKeyCopy` return null on a wrong password (`vaultKeyCopy` is the only way to export the key, for the fingerprint wrap). `delete` writes a `Deleted` tombstone. `rows()` skips tombstones. `lock()` zero-fills the key.
  - `object LockPolicy { fun expired(lastUsedAt: Long, now: Long, timeoutMinutes: Int): Boolean; fun biometricAllowed(enabled: Boolean, passwordUnlockBoot: Int?, currentBoot: Int): Boolean; fun validTimeout(m: Int): Boolean }` (only 1, 5, 15)

- [ ] **Step 1: Write the failing tests**

```kotlin
@Test fun lockedVaultRefusesReads()            // assertThrows<IllegalStateException> { vault.rows() }
@Test fun putGetDeleteAndRowsHideTombstones()
@Test fun rowsNeverContainPasswords()          // no Row field equals the saved password
@Test fun corruptRecordIsCountedNotDeleted()   // store a garbage record → unlock true, rows() lists the rest, unreadable == 1, store.all() still holds it
@Test fun putManyIsOneTransaction()            // MemoryRecordStore counts putAll calls == 1
@Test fun lockZeroesTheKey()                   // a vaultKeyCopy(pw) taken before lock still works; isUnlocked false afterwards
@Test fun changePasswordKeepsRecords()
@Test fun recoverSetsNewPassword()
@Test fun setUpTwiceIsRefused()                // second setUp throws IllegalStateException("already set up"); the first header is unchanged
@Test fun newRecoveryKeyNeedsCurrentPassword() // newRecoveryKey(wrong) == null and the old recovery key still unlocks
@Test fun enableBiometricNeedsCurrentPassword() // vaultKeyCopy(wrong) == null; vaultKeyCopy(right) contentEquals the key
@Test fun expiresAcrossSleepWithElapsedClock() // fake elapsed jumps 6 min while the wall clock doesn't move → isUnlocked false, key zeroed
@Test fun expiredVaultLocksBeforeServing()     // get() at 4 min doesn't extend; rows() at 5 min throws "locked"; with touch() at 4 min, rows() at 5 min works
// LockPolicyTest
@Test fun expiresAfterTimeout()                // expired(0, 5*60_000, 5) true; expired(0, 5*60_000 - 1, 5) false
@Test fun biometricNeedsPasswordUnlockThisBoot() // biometricAllowed(true, 7, 8) false; (true, 8, 8) true; (false, 8, 8) false; (true, null, 8) false
```

- [ ] **Step 2:** Run `--tests '*VaultTest' --tests '*LockPolicyTest'`. Expected: FAIL.
- [ ] **Step 3:** Implement. The header is stored with `putHeader`. Record ids are `UUID.randomUUID().toString()`. Tests set `KdfParams.testFloor = KdfParams(1024, 1, 1)` in `@Before`, clear it in `@After`, and set up with those params.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit: `Strongroom: vault session and lock rules`.

### Task 6: Matching, browser allowlist, match index and save decisions

**Files:**
- Create: `…/core/PublicSuffix.kt`, `…/core/Matching.kt`, `…/core/Browsers.kt`, `…/core/MatchIndex.kt`, `…/core/Saves.kt`, `…/core/LinkPrompt.kt`
- Create: `apps/strongroom/modules/strongroom-vault/android/src/main/resources/public_suffix_list.dat` (current copy of `https://publicsuffix.org/list/public_suffix_list.dat`, MPL-2.0, with a first comment line giving that URL and the download date)
- Test: `…/core/PublicSuffixTest.kt`, `…/core/MatchingTest.kt`, `…/core/MatchIndexTest.kt`, `…/core/SavesTest.kt`, `…/core/LinkPromptTest.kt`

**Interfaces:**
- Consumes: `Entry.Login`, `Site`, `AppId`, `AppLink` (Task 4), `Vault` (Task 5).
- Produces:
  - `object PublicSuffix { fun registrableDomain(asciiHost: String): String? }` (the standard PSL algorithm: normal, wildcard and exception rules, from the vendored resource, loaded once; null for a single label or a bare public suffix)
  - `sealed interface Requester { data class App(val id: AppId, val reportedDomain: String?) : Requester; data class Web(val site: Site) : Requester }` (`reportedDomain`: the registrable domain, else the normalized host, of a `webDomain` reported by a non-browser app; null when it reported none)
  - `object Matching { fun normalizeHost(host: String): String?` (lowercase, trailing dot stripped, IDN → punycode via `java.net.IDN.toASCII`) `; fun registrableDomain(host: String): String?` (`PublicSuffix` on the normalized host; null for an IP address, a single-label host or a bare suffix, and such hosts match only the exact same host, port included) `; fun siteFromUrl(url: String): Site?; fun requester(pkg: String, certSha256: String?, webDomain: String?, webScheme: String?, browsers: Set<AppId>): Requester?` (null when the cert is unknown, and for an allowlisted browser with no `webDomain`; a missing `webScheme` is http) `; fun matches(sites: List<Site>, apps: List<AppLink>, r: Requester): Boolean` (the one predicate: an `AppLink` matches only an `App` with the same `AppId` and `domain == reportedDomain`, both null for the app's own screens) `; fun matches(login: Entry.Login, r: Requester): Boolean` (calls the predicate; so does `MatchIndex.find`) `; fun needsHostLabel(site: Site): Boolean }` (true when the host has no registrable domain or ends in `.local`; suggestions then show the host)
  - `object Browsers { val ALLOWLIST: Set<AppId> }`: Chrome (`com.android.chrome`) and Firefox (`org.mozilla.firefox`)
  - `interface Sealer { fun seal(plain: ByteArray): ByteArray; fun open(sealed: ByteArray): ByteArray? }`
  - `data class IndexItem(val id: String, val name: String, val username: String, val sites: List<Site>, val apps: List<AppLink>)`; `object MatchIndex { fun build(entries: Map<String, Entry>): List<IndexItem>; fun encode(items: List<IndexItem>): ByteArray; fun decode(bytes: ByteArray?): List<IndexItem>` (null or garbage → empty) `; fun find(items: List<IndexItem>, r: Requester): List<IndexItem> }`
  - `sealed interface SaveAction { data class Create(val name: String) : SaveAction; data class Update(val id: String) : SaveAction }`; `data class PendingSave(val requester: Requester, val label: String, val username: String, val password: String, val at: Long)`; `object Saves { fun decide(index: List<IndexItem>, r: Requester, username: String, label: String): SaveAction; fun link(login: Entry.Login, r: Requester): Entry.Login` (adds the `Site`, or `AppLink(id, reportedDomain)`) `; fun seal(sealer: Sealer, p: PendingSave): ByteArray?` (null when the sealer throws; the caller then fails the save request) `; fun openAll(sealer: Sealer, sealed: List<ByteArray>): Pair<List<PendingSave>, Int>` (the saves that opened, and how many didn't) `; fun apply(vault: Vault, pending: List<PendingSave>): Int }` (`apply` links a created login to its requester with `link` and skips an update whose password is unchanged)
  - `data class LinkPrompt(val pkg: String?, val domain: String?, val installedFromFile: Boolean, val refusal: String?) { companion object { fun build(login: Entry.Login, r: Requester, installedFromFile: Boolean): LinkPrompt } }`: for an app, its package name and `reportedDomain`; for a site, its registrable domain (shown in bold); never an app label or page title. `refusal` is `"This app has the same name as the saved one but a different signature. It may be fake. Strongroom won't fill it."` when the login already holds the same package with another cert; the screen then offers neither fill nor link.

- [ ] **Step 1: Write the failing tests**

```kotlin
// PublicSuffixTest
@Test fun matchesPslTestCases()                      // every checkPublicSuffix case from the PSL project's tests/test_psl.txt (copied, with its URL), incl. wildcard, exception and IDN rules
// MatchingTest — one test per §7 rule
@Test fun subdomainMatchesRegistrableDomain()        // login.example.com ↔ example.com
@Test fun lookalikeDomainDoesNotMatch()              // example.com.evil.io, examp1e.com, evil-example.com
@Test fun publicSuffixIsRespected()                  // a.github.io does NOT match b.github.io
@Test fun httpsLoginNeverFillsOnHttp()               // saved Site(true,…) vs Web(Site(false,…)) false; saved http fills on both
@Test fun ipMatchesOnlyItselfIncludingPort()         // 192.168.1.1 vs 192.168.1.1:8080 false
@Test fun hostNormalization()                        // "Example.COM." ↔ "example.com"; "bücher.de" ↔ "xn--bcher-kva.de"
@Test fun appNeedsPackageAndCert()                   // same pkg, other cert → false
@Test fun webDomainFromNonBrowserIsIgnored()         // requester("com.evil", c, "login.bank.com", "https", ALLOWLIST) == App(AppId("com.evil", c), "bank.com")
@Test fun webDomainFromAllowlistedBrowserIsWeb()
@Test fun nullRegistrableDomainNeverMatchesOtherHost() // "printer" vs "scanner", 10.0.0.1 vs 10.0.0.2 → false; the same host → true
@Test fun missingSchemeIsHttp()                      // requester(chrome, chromeCert, "example.com", null, ALLOWLIST) == Web(Site(false, "example.com")); an https login doesn't fill it
@Test fun unknownRequesterCertMatchesNothing()       // requester("com.bank", null, null, null, ALLOWLIST) == null
@Test fun allowlistedBrowserIsNeverStoredAsAppLink() // requester(chrome, chromeCert, null, null, ALLOWLIST) == null, so nothing can link or save to Chrome itself
@Test fun ipAndLocalHostsShowHost()                  // needsHostLabel true for Site(false, "192.168.1.1"), Site(false, "nas"), Site(false, "printer.local"); false for Site(true, "login.example.com")
// MatchIndexTest
@Test fun indexHoldsNoPasswords()                    // encode(build(...)) bytes contain no password bytes
@Test fun garbageIndexDecodesEmpty()                 // decode(byteArrayOf(1,2,3)) and decode(null) are empty lists
@Test fun findAppliesTheSameRules()                  // AppLink(id, "bank.com") item: find(App(id, "evil.com")) empty; https-site item: find(Web(Site(false, same host))) empty
// SavesTest
@Test fun sameRequesterAndUsernameIsUpdate()
@Test fun newUsernameIsCreate()
@Test fun applyCreatesLoginLinkedToRequester()
@Test fun applyDoesNotDuplicateIdenticalSave()
@Test fun linkFromNonBrowserIsScopedToReportedDomain() // link(login, App(id, "bank.com")) adds AppLink(id, "bank.com"); it matches App(id, "bank.com"), not App(id, "evil.com") or App(id, null)
@Test fun saveFromNonBrowserPageDoesNotUpdateOtherSitesLogin() // index holds AppLink(id, "bank.com") + user u; decide(index, App(id, "evil.com"), u, …) is Create
@Test fun pendingSaveSealFailureIsReported()         // Saves.seal(throwingSealer, p) == null
@Test fun unopenablePendingSavesAreCounted()         // openAll(sealer, [good, garbage]) → one save, 1 lost
// LinkPromptTest
@Test fun linkRefusedForSamePackageOtherCert()       // login holds AppLink(AppId("com.bank", certA), null); build(login, App(AppId("com.bank", certB), null), false).refusal is the exact text above
@Test fun promptShowsPackageAndSideloadFlag()        // App(AppId("com.x", c), null), true → pkg "com.x", installedFromFile true; Web(Site(true, "login.example.com")) → domain "example.com", pkg null
```

- [ ] **Step 2:** Run `--tests '*PublicSuffixTest' --tests '*MatchingTest' --tests '*MatchIndexTest' --tests '*SavesTest' --tests '*LinkPromptTest'`. Expected: FAIL.
- [ ] **Step 3:** Download `public_suffix_list.dat` and `tests/test_psl.txt` (from `github.com/publicsuffix/list`); don't write either from memory. Fill in `Browsers.ALLOWLIST` cert digests from Google's Credential Manager privileged-apps list (`https://www.gstatic.com/gpm-passkeys-privileged-apps/apps.json`). Copy them, don't recall them, and note the source and date in a one-line comment. Task 9 cross-checks them against the phone.
- [ ] **Step 4:** Implement the rest. Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `Strongroom: matching rules, browser allowlist, match index and saves`.

### Task 7: Google Password Manager import

**Files:**
- Create: `…/core/Csv.kt`, `…/core/GoogleImport.kt`
- Create: `apps/strongroom/tools/redact-google-csv.mjs` (owner runs: `node apps/strongroom/tools/redact-google-csv.mjs <in.csv> <out.csv>`; replaces each username with `user<N>@example.com` and each password with `pw<N>`, and keeps names, URLs, notes and quoting)
- Create: `…/src/test/resources/google-export-redacted.csv` (from the owner's run; until then a hand-made file in the same shape)
- Test: `…/core/CsvTest.kt`, `…/core/GoogleImportTest.kt`

**Interfaces:**
- Consumes: `Entry.Login`, `Site`, `AppId`, `AppLink`, `Matching.siteFromUrl` (Tasks 4, 6).
- Produces:
  - `object Csv { fun parse(text: String): List<List<String>> }` (RFC 4180; strips a leading BOM; accepts CRLF and LF)
  - `data class ImportResult(val logins: List<Entry.Login>, val merged: Int, val flagged: Int)`; `class ImportError(message: String) : Exception(message)`; `object GoogleImport { fun parse(csv: String, now: Long): ImportResult }`. It finds columns by header name (`name,url,username,password,note`, in any order; `note` optional). It throws `ImportError("This file isn't a Google Passwords export. Export again from Google Password Manager and pick that file.")` when a required column is missing. `android://<base64 sha256>@<pkg>/` becomes `AppLink(AppId(pkg, hex), null)`; a hash that doesn't decode to 32 bytes gives no app link (never `AppId(pkg, "")`), and the login is still imported. Flagged logins get the note prefix `"Imported twice with different passwords. Delete the wrong one.\n"`.

- [ ] **Step 0 (owner):** Ask the owner to export from Google Password Manager, run the redaction script on their Mac, and share only the redacted file. Use the hand-made fixture until it arrives. When it does, confirm the column names and the `android://` form match this task. If they don't, fix the parser and the DESIGN §8 text.
- [ ] **Step 1: Write the failing tests**

```kotlin
@Test fun quotedCommasQuotesAndNewlines()       // "a,b","say ""hi""","line1\nline2"
@Test fun bomAndCrlf()                          // "﻿name,url\r\nx,y\r\n" → [[name,url],[x,y]]
@Test fun androidUrlBecomesAppId()              // android://<b64 of 32 bytes 0x01>@com.example/ → apps == [AppLink(AppId("com.example", "0101…01"), null)]
@Test fun undecodableCertGivesNoAppId()         // android://not-base64!@com.example/ → one login, apps empty
@Test fun webUrlBecomesSite()                   // https://accounts.example.com/login → Site(true, "accounts.example.com")
@Test fun exactDuplicatesMerge()                // two identical rows → 1 login, merged == 1
@Test fun samePlaceSameUserDifferentPasswordIsFlagged() // 2 logins, flagged == 2, both notes start with the prefix
@Test fun emptyUsernameAndPathlessUrlImport()
@Test fun wrongFileThrowsImportError()
@Test fun redactedFixtureParses()               // loads google-export-redacted.csv; logins.size equals data rows minus merges
```

- [ ] **Step 2:** Run `--tests '*CsvTest' --tests '*GoogleImportTest'`. Expected: FAIL.
- [ ] **Step 3:** Implement. The login `name` is the CSV `name`, else the registrable domain, else the package.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit: `Strongroom: Google Password Manager import and redaction script`.

### Task 8: Form detection and the unlock request

**Files:**
- Create: `…/core/FormDetector.kt`, `…/core/AuthRequest.kt`
- Test: `…/core/FormDetectorTest.kt`, `…/core/AuthRequestTest.kt`

**Interfaces:**
- Consumes: `Requester`, `Matching.normalizeHost` (Task 6).
- Produces:
  - `data class AuthRequest(val mode: String, val entryId: String?, val requester: Requester, val label: String) { fun extras(): Map<String, String>; companion object { fun parse(get: (String) -> String?): AuthRequest? } }`. `mode` is `fill`, `pick` or `cards`. Keys all start with `strongroom.`. `parse` reads only those keys (never `AutofillManager.EXTRA_ASSIST_STRUCTURE` or `EXTRA_CLIENT_STATE`) and returns null when one is missing or malformed. Target `AutofillId`s travel in Strongroom's own parcelable extra, set by the service, not through this class.
  - `fun shouldServe(pkg: String, ownPkg: String): Boolean` (false for Strongroom's own package)
  - `data class FieldNode(val index: Int, val hints: List<String>, val inputType: Int, val htmlType: String?, val htmlAutocomplete: String?, val htmlName: String?, val idEntry: String?, val hintText: String?, val webDomain: String?)` (the Android adapter flattens `ViewNode`s into these; `index` maps back to its `AutofillId`; `webDomain` is the nearest ancestor-or-self node's)
  - `data class CardFields(val number: Int?, val holder: Int?, val expMonth: Int?, val expYear: Int?, val expDate: Int?, val cvc: Int?)`
  - `data class DetectedForm(val username: Int?, val password: Int?, val newPassword: Int?, val card: CardFields?)`; `object FormDetector { fun detect(nodes: List<FieldNode>): DetectedForm; fun allTargetsInDomain(nodes: List<FieldNode>, form: DetectedForm, requesterHost: String): Boolean }` (`allTargetsInDomain`: every node the form would fill has a `webDomain` whose `Matching.normalizeHost` equals `requesterHost`; a null `webDomain` fails). Priority: autofill hints → `htmlAutocomplete` (`username`, `current-password`, `new-password`, `cc-*`) → input type (`TYPE_TEXT_VARIATION_PASSWORD`, `WEB_PASSWORD`, `VISIBLE_PASSWORD`, email variations) → id/name/hint keywords (`user`, `email`, `login`, `pass`). Username is the nearest text field before the password.

- [ ] **Step 1: Write the failing tests**

```kotlin
@Test fun hintsWin()                      // hints ["username"], ["password"]
@Test fun htmlAutocompleteNewPassword()   // sign-up form → newPassword set, password null
@Test fun inputTypeOnlyLoginForm()        // email field + password-type field, no hints
@Test fun usernameIsFieldBeforePassword() // search box, email, password → username is the email
@Test fun cardFieldsFromAutocomplete()    // cc-number, cc-exp-month, cc-exp-year, cc-csc
@Test fun noPasswordNoCardIsEmptyForm()   // a search box alone → all null
@Test fun crossOriginFrameGetsNoFill()    // username node webDomain "bank.com", password node "ads.example" → allTargetsInDomain(…, "bank.com") false; both "Bank.com." → true; a null webDomain → false
// AuthRequestTest
@Test fun extrasRoundTrip()               // parse(req.extras()::get) == req, for an App (with and without reportedDomain) and a Web requester
@Test fun parseReadsOnlyOwnExtras()       // the get() fake records keys and also answers ASSIST_STRUCTURE / CLIENT_STATE: every key read starts with "strongroom."
@Test fun ownPackageIsNeverServed()       // shouldServe("com.haroon.strongroom", "com.haroon.strongroom") false; ("com.bank", …) true
```

- [ ] **Step 2:** Run `--tests '*FormDetectorTest' --tests '*AuthRequestTest'`. Expected: FAIL.
- [ ] **Step 3:** Implement. Run again. Expected: PASS.
- [ ] **Step 4:** Commit: `Strongroom: form detection and the unlock request`.

### Task 9: Android adapters and the JS bridge

**Files:**
- Create: `…/android/SqliteRecordStore.kt` (`SQLiteOpenHelper`, db `strongroom.db`, tables `header(k TEXT PRIMARY KEY, v TEXT)` and `records(id TEXT PRIMARY KEY, sealed BLOB NOT NULL)`, `putAll` in one transaction)
- Create: `…/android/Keys.kt` (Keystore aliases `strongroom-biometric`: AES-GCM, `setUserAuthenticationRequired(true)`, `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)`, `setInvalidatedByBiometricEnrollment(true)`; and `strongroom-device`: AES-GCM, no user auth, `setUnlockedDeviceRequired(true)`, implements `Sealer`)
- Create: `…/android/VaultHolder.kt` (process singleton: `Vault` built with `System::currentTimeMillis` and `SystemClock::elapsedRealtime`, a timer that locks promptly at expiry (the `Vault` access check is the real gate), boot count from `Settings.Global.BOOT_COUNT`, match index file `index.bin` sealed with `strongroom-device`, pending saves file `pending.bin` holding one `Saves.seal` blob per save, so a lost key still gives the count)
- Create: `…/android/SensitiveClipboard.kt`
- Modify: `StrongroomVaultModule.kt`, `apps/strongroom/modules/strongroom-vault/src/index.ts`, module `AndroidManifest.xml` (`android.permission.HIDE_OVERLAY_WINDOWS`)
- Modify: `apps/strongroom/android/app/src/main/java/com/haroon/strongroom/MainActivity.kt` (in `onCreate`: the per-activity window rules from Global Constraints)

**Interfaces:**
- Consumes: everything in `core/` (Tasks 3–8).
- Produces (`VaultHolder`, used by Task 10): `fun get(context: Context): Vault; fun touch()` (module calls from the screens and unlocks only; the autofill service never calls it) `; fun index(context: Context): List<IndexItem>; fun refreshIndex(context: Context)` (called after every unlock and change) `; fun addPending(context: Context, p: PendingSave): Boolean` (false when sealing fails) `; fun applyPending(context: Context): Int` (called on unlock; saves that won't open are added to `lostSaves`) `; val lostSaves: Int; fun biometricUnlock(activity: FragmentActivity, onResult: (Boolean) -> Unit); fun passwordUnlock(context: Context, password: CharArray): Boolean`
- Produces (TS, `strongroom-vault`), used by Task 11:

```ts
export interface Status { setUp: boolean; unlocked: boolean; biometricEnabled: boolean; autofillSelected: boolean; autoLockMinutes: 1 | 5 | 15; unreadable: number; lostSaves: number }
export interface Row { id: string; type: 'login' | 'card' | 'note'; name: string; subtitle: string }
export type EntryInput =
  | { type: 'login'; name: string; username: string; password: string; sites: string[]; note: string }
  | { type: 'card'; name: string; holder: string; number: string; expMonth: number | null; expYear: number | null; cvc: string; note: string }
  | { type: 'note'; name: string; text: string };
export interface EntryView { id: string; type: Row['type']; name: string; username?: string; sites?: string[]; apps?: string[]; holder?: string; last4?: string; note: string; text?: string }
export interface ImportPreview { found: number; merged: number; flagged: number }
// default export StrongroomVault:
getStatus(): Status; generateRecoveryKey(): string; setUp(password: string, recoveryKey: string): Promise<void>;
unlock(password: string): Promise<boolean>; unlockWithBiometric(): Promise<boolean>; recover(recoveryKey: string, newPassword: string): Promise<boolean>; lock(): void;
rows(): Row[]; entry(id: string): EntryView | null; reveal(id: string, field: 'password' | 'number' | 'cvc'): string;
copy(id: string, field: 'username' | 'password' | 'number' | 'cvc'): void; save(id: string | null, e: EntryInput): string; remove(id: string): void;
pickGoogleCsv(): Promise<ImportPreview | null>; commitImport(): number;
setBiometric(enabled: boolean, password?: string): Promise<boolean>; // password required to turn it on; false when it's wrong
setAutoLockMinutes(m: 1 | 5 | 15): void; changePassword(oldPw: string, newPw: string): Promise<boolean>;
newRecoveryKey(password: string): Promise<string | null>; // null when the password is wrong
openAutofillSettings(): void; setPalette(json: string): void;
diagnostics(): { lastUnlockMs: number | null; browsers: { pkg: string; installed: boolean; trusted: boolean }[] }; // trusted = installed cert digest is in Browsers.ALLOWLIST
```

- [ ] **Step 1:** Implement the adapters and module functions. Run Argon2 and SQLite work on `Dispatchers.IO` (Deputy's `Coroutine` pattern). `pickGoogleCsv` uses `ACTION_OPEN_DOCUMENT` (`text/*`, `OnActivityResult` like Deputy's speech request), reads the file natively, keeps the parsed result in memory, and returns counts only. `copy` sets `ClipDescription.EXTRA_IS_SENSITIVE` and clears the clip after 30 s if it's still ours. `setBiometric(true, password)` wraps `vaultKeyCopy(password)` through `BiometricPrompt` with a `CryptoObject`, and returns false without prompting when that is null. A `KeyPermanentlyInvalidatedException` disables biometric and returns false. Every module function calls `VaultHolder.touch()` after its access check. `unlock` and `recover` reject (not resolve false) on `KdfOutOfRange`. `save` on an existing login keeps its stored `apps`; only `sites` come from the input. `index()` returns empty when the sealer can't open the file, and `refreshIndex` rewrites it.
- [ ] **Step 2:** Run `pnpm typecheck` and the Gradle gate. Expected: no errors and `BUILD SUCCESSFUL`.
- [ ] **Step 3 (emulator):** On a debug build, check that set-up, unlock, lock and reopen work through a temporary button in `App.tsx`. Then check `diagnostics()`: `lastUnlockMs` is set, and Chrome shows `trusted: true`. A false means the allowlist digest from Task 6 is wrong. Fix it before continuing. The real-phone timing check is in Task 12.
- [ ] **Step 4:** Commit: `Strongroom: Android storage, Keystore keys and the JS bridge`.

### Task 10: Autofill service and the unlock activity

**Files:**
- Create: `…/android/StrongroomAutofillService.kt`, `…/android/StructureReader.kt` (`AssistStructure` → `List<FieldNode>` plus `AutofillId` table, package, `webDomain`, `webScheme`), `…/android/Datasets.kt` (dataset, inline presentation and `SaveInfo` builders), `…/android/UnlockActivity.kt` (AppCompat; modes `fill`, `pick` and `cards`, as in `AuthRequest`; colours from `setPalette`)
- Create: `…/android/src/main/res/xml/strongroom_autofill_service.xml` (`<autofill-service supportsInlineSuggestions="true"/>`)
- Modify: `…/android/src/main/AndroidManifest.xml` (service with `android.permission.BIND_AUTOFILL_SERVICE`, intent filter `android.service.autofill.AutofillService`, meta-data; `UnlockActivity` not exported, `excludeFromRecents`)

**Interfaces:**
- Consumes: `VaultHolder` (Task 9); `FormDetector`, `AuthRequest`, `shouldServe` (Task 8); `Matching`, `Browsers`, `MatchIndex`, `Saves`, `LinkPrompt` (Task 6).
- Produces: nothing new for TS. `getStatus().autofillSelected` reads `AutofillManager.hasEnabledAutofillServices()`.

Behaviour (§7):
- `onFillRequest` and `onSaveRequest` start with `shouldServe(pkg, packageName)`; false → `callback.onSuccess(null)`.
- `onFillRequest`: read the structure, then `Matching.requester(...)` with the caller's cert (`PackageManager.getPackageInfo(pkg, GET_SIGNING_CERTIFICATES)`, SHA-256 of the first signer; any failure passes `null`), then `FormDetector.detect`. A null requester, or no password and no card fields → `callback.onSuccess(null)`. For a `Web` requester, also `onSuccess(null)` unless `FormDetector.allTargetsInDomain(nodes, form, requester.site.host)` (cross-origin frame → no fill). Otherwise build datasets:
  - Unlocked: matching logins with real values, labelled like the locked ones below.
  - Locked: one dataset per `MatchIndex.find` hit, showing the username (plus the host when `Matching.needsHostLabel(site)`), carrying an authentication `IntentSender` to `UnlockActivity` (`fill` mode, entry id).
  - Always add an "Other logins" dataset to `UnlockActivity` (`pick` mode).
  - Card fields detected: unlocked, one dataset per card (all cards; no site matching), showing name and `•••• last4`, **always** with the authentication intent (`fill` mode), so every card fill asks for the fingerprint. Locked: one generic "Unlock to fill a card" dataset (`cards` mode), since the index holds no cards.
  - Every authentication intent: `PendingIntent.FLAG_IMMUTABLE` (mutable only if Android demands it, still reading only our own extras), a unique request code and data URI per dataset, extras from `AuthRequest.extras()` plus our own target-`AutofillId` extra, built from the structure this request received. Nothing that decides the outcome goes in the `FillResponse` client state.
  - Inline presentations when `request.inlineSuggestionsRequest` is present. `SaveInfo` for the username and password (or new-password) ids.
- `UnlockActivity`: the per-activity window rules (Global Constraints), and `filterTouchesWhenObscured` on the Fill and Always-use buttons. It reads its request only through `AuthRequest.parse { intent.getStringExtra(it) }` and our own target extra; never `EXTRA_ASSIST_STRUCTURE` or `EXTRA_CLIENT_STATE`. Fingerprint first if `LockPolicy.biometricAllowed`, otherwise the master password field (an `EditText` with `TYPE_CLASS_TEXT | TYPE_TEXT_VARIATION_PASSWORD | TYPE_TEXT_FLAG_NO_SUGGESTIONS` and no autofill hints). Every mode unlocks before showing anything. A card fill authenticates even when the vault is already unlocked (fingerprint, or the master password when `biometricAllowed` is false). In `fill` mode it re-runs `Matching.matches` on the decrypted login (cards skip this) and returns exactly one `Dataset` as `EXTRA_AUTHENTICATION_RESULT`. In `pick` mode it lists logins with a search field (`cards` mode lists cards). Picking a login the requester doesn't match shows `LinkPrompt.build(login, requester, installedFromFile)` (`installedFromFile` from `getInstallSourceInfo`: no installing package, or a file manager or the package installer): the package name and sideload flag, or the domain in bold. Buttons: **Fill once** (default, stores nothing) and **Always use here** (`Saves.link`, then fill). A non-null `refusal` shows that text and offers only Cancel.
- `onSaveRequest`: read the values. If unlocked, `Saves.apply` immediately and `callback.onSuccess()`. If locked, `VaultHolder.addPending`: true → `callback.onSuccess()`; false → `callback.onFailure("Strongroom couldn't keep this password. Unlock Strongroom and save it again.")`.

- [ ] **Step 1:** Implement, keeping the service thin. All decisions call `core/`, which Tasks 6 and 8 already test.
- [ ] **Step 2:** Run the Gradle gate. Expected: `BUILD SUCCESSFUL`, with every existing JVM test still passing.
- [ ] **Step 3 (emulator):** With Strongroom chosen as the autofill service, check:
  - fill in one app and on one site in Chrome (with Chrome's "use another service" setting on), locked and unlocked;
  - a card fill on a checkout test page, which asks for the fingerprint even when unlocked;
  - a save prompt after sign-up, and Update after a password change;
  - "Other logins": Fill once stores no link; Always use here does;
  - a login form inside a cross-origin iframe gets no fill (S1), and whether Chrome sets `webScheme` at all (S2; without it every page counts as http, so https logins won't fill: tell the owner);
  - the `FLAG_IMMUTABLE` authentication intents complete a fill (S6; the phone check is in Task 12);
  - with Google as the autofill service, typing the master password in `UnlockActivity` brings no "Save to Google" offer;
  - whether the 30-second clipboard clear works with the app in the background (if not, change the toast as DESIGN §7 says).

  Record the results in the handoff.
- [ ] **Step 4:** Commit: `Strongroom: autofill service and unlock activity`.

### Task 11: Screens

**Files:**
- Create: `apps/strongroom/src/forms.ts` (pure), `apps/strongroom/src/__tests__/forms.test.ts`
- Create: `apps/strongroom/src/common-passwords.ts` (exports the SecLists `Passwords/Common-Credentials/10k-most-common.txt` entries of 12+ characters, lowercased; shorter ones already fail the length rule. Header comment: source URL, licence MIT, download date. Download it; don't write it from memory.)
- Create: `apps/strongroom/src/{SetupScreen,UnlockScreen,VaultScreen,EntryScreen,EditScreen,ImportScreen,SettingsScreen}.tsx`
- Modify: `apps/strongroom/App.tsx` (routes: not set up → Setup; locked → Unlock; else tabs Vault / Settings; re-check `getStatus()` on `AppState` active, as Deputy does), `apps/strongroom/package.json` (`"test": "node --test src/__tests__/forms.test.ts"`)

**Interfaces:**
- Consumes: the TS API from Task 9.
- Produces (`forms.ts`): `validateMasterPassword(pw: string, confirm: string): string | null` (null when valid; errors: `"Use at least 12 characters."`, `"That password is too common. Pick something only you would think of."` (on the common list ignoring case, one repeated character, or a straight run where each character is one more or one less than the last), `"The two passwords don't match."`) `; recoveryGroupMatches(formatted: string, groupIndex: number, typed: string): boolean` (ignores case and spaces) `; filterRows(rows: Row[], query: string): Row[]` (case-insensitive substring of name or subtitle) `; pickGroupIndex(random: () => number): number` (0–7)

- [ ] **Step 1: Write the failing tests** (`node:test` + `node:assert/strict`)

```ts
test('rejects 11 characters, accepts 12', …)        // validateMasterPassword('a'.repeat(11), same) === 'Use at least 12 characters.'
test('rejects mismatched confirm', …)
test('rejects common 12-character passwords', …)      // a 12+-character entry from common-passwords.ts in upper case, 'aaaaaaaaaaaa', 'abcdefghijkl', 'lkjihgfedcba' → the too-common error; a random 12-character string → null
test('recovery group check ignores case and spaces', …) // recoveryGroupMatches('AAAA-BBBB-…', 1, ' bbbb ') === true
test('recovery group check rejects wrong group', …)
test('filterRows matches name and username, case-insensitive', …)
test('filterRows with empty query returns all rows', …)
```

- [ ] **Step 2:** Run `node --test apps/strongroom/src/__tests__/forms.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `forms.ts`, then the screens from `@apps-hub/ui` (`Screen`, `Header`, `Group`/`Row`, `Field`, `Segmented`, `Button`, `Notice`, `TabBar`, `Sheet`), following the mockup layout:
  - Setup order (§9): master password → recovery key (shown, then type back group `pickGroupIndex`) → fingerprint (`setBiometric(true, password)` with the password just typed) → `openAutofillSettings()` → Chrome-setting instructions → optional import.
  - Setup, Change master password and Recovery (Unlock → "Forgot master password") all validate the new password with `validateMasterPassword`.
  - Every screen root has `importantForAutofill="noExcludeDescendants"`. Password and recovery-key inputs use `secureTextEntry` (or `keyboardType="visible-password"` while shown), `autoCorrect={false}` and `autoComplete="off"`. If `@apps-hub/ui`'s `Field` or `Screen` doesn't pass these props through, add that to the package.
  - On API 33 only, the revealed password `Text` gets `importantForAccessibility="no-hide-descendants"`. API 34+ is covered by `MainActivity`'s data-sensitive root (Task 9).
  - Show a `Notice` when `status.unreadable > 0`: "N entries can't be opened. They're kept unchanged." Show another when `status.lostSaves > 0`: "N saved passwords couldn't be recovered."
  - The import screen shows the Google steps, the preview counts, and after commit the warning "Delete the exported file now. It isn't encrypted, so anyone who gets it can read every password in it."
  - Settings: auto-lock 1 / 5 / 15 min (`Segmented`), fingerprint toggle (turning it on asks for the master password), change master password, new recovery key (asks for the master password, then `newRecoveryKey(password)`; null → "That password is wrong. Try again."), lock now. A "Checks" group shows `diagnostics()`: last unlock time, and for each installed browser either "Recognised" or "Not recognised: autofill won't work in <browser>". Remove Task 9's temporary button.
- [ ] **Step 4:** Run `pnpm --filter strongroom test && pnpm typecheck`. Expected: PASS, no errors.
- [ ] **Step 5:** Commit: `Strongroom: setup, unlock, vault, entry, import and settings screens`.

### Task 12: Security review, on-disk check and acceptance on the phone

**Files:**
- Create: `apps/strongroom/tools/disk-check.sh` (debug build: `adb exec-out run-as com.haroon.strongroom tar c .` piped to `grep -c` for a known password and username in plain bytes, UTF-16 and Base64. Exits non-zero on any hit.)
- Modify: `docs/handoffs/strongroom.md` (results, current state, next step)

- [ ] **Step 1:** Dispatch `security-engineer` to review `core/`, `android/` and `StrongroomVaultModule.kt` against DESIGN §6–§7 (the reviewer's points included) and this plan's Review Focus. Fix confirmed findings with a test each.
- [ ] **Step 2 (emulator, debug build: `run-as` needs a debuggable app):** Save login `disk-check-user` / `Disk-Check-Pass-7731` and leave one pending save while locked. Run `apps/strongroom/tools/disk-check.sh disk-check-user Disk-Check-Pass-7731`. Expected: `0 hits`, exit 0. Then, with Google as the autofill service, run setup and Add on a fresh install. Expected: no "Save to Google" offer at any point.
- [ ] **Step 3:** Run the full gates: `pnpm test`, `pnpm typecheck`, and the Gradle `:strongroom-vault:testDebugUnitTest :app:assembleDebug`. Then build the release APK (`:app:assembleRelease`) and run `$ANDROID_HOME/build-tools/36.0.0/aapt2 dump permissions` on it. Expected: no `android.permission.INTERNET`. Report the actual output.
- [ ] **Step 4 (owner, phone):** With the owner's go-ahead, run `pnpm release strongroom` and install from the Store. In Settings → Checks:
  - The unlock time must be 1–2 s. If it isn't, change `KdfParams.DEFAULT` (m 32768–131072 KiB, t 2–6; never below `KdfParams.FLOOR`), update the vectors note, and release again. The header stores the params, so an existing vault keeps working.
  - Chrome (and Firefox if installed) must show "Recognised".

  Also on the phone (Android 16, HyperOS), record each result:
  - Deputy's tree dump of Strongroom's main screen with a password shown, and of the unlock screen, is empty (B5).
  - The `FLAG_IMMUTABLE` authentication intents complete a fill (S6).
  - After Show and after typing the master password, the keyboard doesn't suggest the password back (S4).
  - After Copy, the keyboard's clipboard history doesn't show the password (S5). If it does, say so in the copy toast.

  Then walk through DESIGN §13 together and record pass/fail for each line in the handoff. No fixture apps exist for the §13 matching lines about a different-signature app (no suggestion, can't be linked) and a non-browser app's WebView: record those as JVM-only, covered by `MatchingTest` (`appNeedsPackageAndCert`, `webDomainFromNonBrowserIsIgnored`) and `LinkPromptTest` (`linkRefusedForSamePackageOtherCert`). Tell the owner: "Other logins" defaults to Fill once, and Always use here is a separate button; Deputy should refuse to operate Strongroom (a Deputy change, not in this plan); Mi Browser isn't on the allowlist, so it gets only app-scoped, domain-bound links; the §10 account-key question needs an answer before Phase 2. Afterwards the owner switches autofill and Chrome back to Google.
- [ ] **Step 5:** Commit: `Strongroom Phase 1: security review fixes and acceptance results`.
