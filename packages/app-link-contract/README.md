# @apps-hub/app-link-contract

How one of the owner's apps lets another app read from it or start something in it, and how the receiving app decides who may ask. Pure TypeScript plus four Kotlin files (and one Kotlin test) to copy into an app.

There are two families of link:

- **Shares**: a read-only content provider path with typed columns (`defineShare`). Example: Inflow's suggestions, read by Deputy.
- **Actions**: an exported activity another app starts with an intent (`defineAction`). It always shows the user a screen first.

One permission guards both: `com.haroon.permission.AUTOPILOT` (exported as `LINK_PERMISSION`), declared with `protectionLevel="signature"`, so only apps signed with the same key can hold it. The name stays "autopilot" on purpose (ruling R1 in the E1 phase): Android lets a provider or activity name only one permission, so a rename would need every app released at the same moment. The cost is a name that reads oddly for links that have nothing to do with Autopilot. `autopilot-contract` re-exports it as `PERMISSION`.

Domain facts live in `packages/autopilot-contract` (Autopilot's `SuggestionRow`, never-share list and fixtures). It is built on this package; its exports and fixtures are unchanged.

## Before you rely on a link

Only Inflow and Deputy declare the permission today (`<permission>` plus `<uses-permission>`); Halo, Design Editor and the others do not. A new link app must declare both in its module manifest, and `auditManifest` requires them as soon as a component names the permission.

Signature trust only holds for apps installed from a Store release, because only `tools/release` signs with the shared key and refuses an APK signed by anyone else. A debug build, or a release built without the key, is signed with the public Expo debug key and is refused by every guarded link (it fails closed). See "Signing finding" below.

## Add a share

1. **Declare it** in the contract package of the app (or next to it), with the row type spelled out:

   ```ts
   import { defineShare } from '@apps-hub/app-link-contract';

   interface NoteRow { id: number; title: string; due_at: number | null }

   export const NOTES_SHARE = defineShare<NoteRow>()({
     authority: 'com.haroon.notes.applink',
     path: 'notes',
     columns: { id: 'long', title: 'string', due_at: 'long?' },
     description: 'Notes the owner pinned, read by Deputy',
   });
   ```

   `columns` has one entry per row field, and `tsc` checks it against the row type. Leave a field out and you get:

   ```text
   error TS2741: Property 'title' is missing in type '{ id: "long"; }' but required in type '{ id: "long" | "int" | "double"; title: "string"; }'.
   ```

   Declare a boolean field (`done: boolean`) as `'int'` and you get `error TS2322: Type 'string' is not assignable to type 'never'.` A boolean, an object or an array has no column type: store it as a number or a string. At runtime `defineShare` also refuses a bad authority, a path that is not 1 to 3 lowercase segments, more than 24 columns, `maxRows` above 500 (default 200) and any column named like a secret: the substrings password, passwd, passcode, passphrase, secret, token, apikey, api_key, private, credential, session, cookie, mnemonic, cardnumber, totp and hotp anywhere in the name, and the whole `_` words pin, otp, seed, cvv, cvc, code, key, pass, pwd, passcode, auth, iban and card (plural too). The list is blunt on purpose: harmless names such as `keyboard`, `pinned`, `speed` and `decode_ms` stay allowed, but `status_code` and `item_key` are refused, so name them `status_id` and `item_ref`. This checks names only, never values.

2. **Choose the authority** `com.haroon.<app>.applink`. `com.haroon.inflow.autopilot` is the one legacy authority that stays valid.

3. **Write the provider**: a `ContentProvider` that calls `AppLinkCaller.allowed(context)` first in `query`, throws `SecurityException` when it returns false, and answers with a `MatrixCursor` whose columns are exactly the share's columns, at most `maxRows` rows. `insert`, `update` and `delete` throw `UnsupportedOperationException`. Pass ids as numbers only (`share.uri(3)`), never free text. Two rules for every provider method:

   - `ContentProvider.call()` has no framework permission check (only `query`, `insert`, `update` and `delete` are covered by `readPermission` and `writePermission`), so a provider that overrides `call` must run `AppLinkCaller.allowed` first there too.
   - `AppLinkCaller.allowed` must run synchronously in the provider method, on the binder thread, before any hop to another thread: it reads `Binder.getCallingUid()`, which on a worker thread is the app's own uid and would pass as "self".

   ```kotlin
   class NotesLinkProvider : ContentProvider() {
     override fun onCreate() = true

     override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor {
       if (context?.let { AppLinkCaller.allowed(it) } != true) throw SecurityException("Not a signed sibling app")
       return MatrixCursor(arrayOf("id", "title", "due_at")).also { /* add rows, at most 200 */ }
     }

     override fun insert(uri: Uri, values: ContentValues?): Uri = throw UnsupportedOperationException("Read-only")
     override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")
     override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")
     override fun getType(uri: Uri): String? = null
   }
   ```

4. **Declare it** in the module's `AndroidManifest.xml` (`apps/<app>/modules/<module>/android/src/main/`). Exported, read and write both need the permission, no URI grants, and the permission declared with `signature` plus a `<uses-permission>`:

   ```xml
   <permission android:name="com.haroon.permission.AUTOPILOT" android:protectionLevel="signature" />
   <uses-permission android:name="com.haroon.permission.AUTOPILOT" />
   <application>
     <provider
       android:name=".android.NotesLinkProvider"
       android:authorities="com.haroon.notes.applink"
       android:exported="true"
       android:readPermission="com.haroon.permission.AUTOPILOT"
       android:writePermission="com.haroon.permission.AUTOPILOT" />
   </application>
   ```

   Never set `android:grantUriPermissions="true"` or add `<grant-uri-permission>`: a granted URI would let an app without the permission read the share.

5. **Copy the guard in.** Copy `android/AppLinkGuard.kt` and `android/AppLinkCaller.kt` into the module's `android/src/main/java/...` and change only the `package` line (ruling R2). It is a copy, not a shared Gradle module, because each app has its own committed `android/` prebuild. `src/__tests__/copies.test.ts` finds every `.kt` file under `apps/` that is named `AppLinkGuard.kt`, `AppLinkCaller.kt` or `AppLinkActivityCaller.kt`, or declares one of those three objects (modifiers and indentation allowed), and fails when a copy is not named like the canonical file, has more than the one plain `package <name>` line, or differs in any other line, so drift is loud. Inflow's copy is in `apps/inflow/modules/inflow-core/android/src/main/java/expo/modules/inflowcore/applink/`.

6. **Bind the provider to the share.** The share's rules (column names, types, row cap) are checked in TypeScript, so the provider has to be tied to them or it can serve more than the share says. Generate a fixture from the share in a node test, and read it in a JVM test next to the provider. Autopilot's pattern: `packages/autopilot-contract/fixtures/suggestions.share.json` (`{ authority, path, columns, maxRows }`) is asserted equal to the live `SUGGESTIONS_SHARE` in `contract.test.ts`, so TypeScript drift fails; Inflow's `AutopilotProviderShareTest.kt` reads the same file and asserts the provider's `ROW_COLUMNS` equal its columns in order, its authority constant equals the fixture's, and `LIST_LIMIT <= maxRows` (the provider's companion constants are `internal` for that). What this guarantees is the names of the columns the provider declares, not the values it puts in them.

7. **Add a Gradle JVM test** like Inflow's `AppLinkGuardTest.kt` (same folder tree under `src/test`): it runs `AppLinkGuard.decide` against every row of `fixtures/caller-decisions.json`, checks the limits against `fixtures/limits.json`, and runs `validateExtras` cases. It reads the fixtures from five folders above the module's `android/` directory, so the app must sit at `apps/<app>/modules/<module>`. `fixtures/extras-cases.json` is one table of extras cases that `extras-cases.test.ts` (TypeScript) and `AppLinkGuardTest.kt` (Kotlin) both run, so the two validators are checked against each other.

8. **Add a node test** that runs `assertRowShape(NOTES_SHARE, row)` on sample rows (keep them in a fixture, as `autopilot-contract` does) and one that runs `auditManifest` on the module manifest:

   ```ts
   import assert from 'node:assert/strict';
   import fs from 'node:fs';
   import test from 'node:test';
   import { auditManifest } from '@apps-hub/app-link-contract';

   test('manifest follows the link rules', () => {
     const xml = fs.readFileSync(new URL('../../modules/notes-core/android/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
     assert.deepEqual(auditManifest(xml), []);
   });
   ```

   The app lists `"@apps-hub/app-link-contract": "workspace:*"` as a dependency, and the new test file is added by name to its `test` script (a new file does nothing until it is listed). `manifest.test.ts` in this package already audits the real Inflow and Deputy manifests.

Reference host: Inflow's `AutopilotProvider` (`apps/inflow/modules/inflow-core/android/src/main/java/expo/modules/inflowcore/android/AutopilotProvider.kt`). Only its `suggestions` list is a declared share (`SUGGESTIONS_SHARE`, bound by `AutopilotProviderShareTest.kt`). It also serves two undeclared legacy paths that predate this recipe: `items/#` answers with a source message (sender, conversation, text; Inflow's `AutopilotAccess` decides which items may cross, and only a caller whose uid holds exactly `com.haroon.deputy` gets a row) and `update` on `suggestions/#` lets a sibling move a suggestion to started, done or skipped. Both sit behind the same `requireSibling()` check and neither has a share, a fixture or a column test. New shares must not copy them: stay read-only and declare every column served.

## Add an action

```ts
import { defineAction, validateExtras } from '@apps-hub/app-link-contract';

export const OPEN_NOTE = defineAction({
  app: 'notes',
  name: 'OPEN_NOTE',
  screen: true,
  extras: { noteId: { type: 'long', required: true }, hint: { type: 'string', max: 200 } },
  description: 'Opens a note on screen',
});
// OPEN_NOTE.name === 'com.haroon.notes.action.OPEN_NOTE'
```

- `screen` is the literal `true`. There is no headless variant to declare. The activity must show the user a screen before it does anything. That is a code-review rule: `auditManifest` only catches a `Theme.NoDisplay` theme (a substring check) and cannot prove a screen is shown, so a translucent theme, or an activity that calls `finish()` in `onCreate`, passes the audit. Review it by hand.
- Manifest: `android:exported="true"`, `android:permission="com.haroon.permission.AUTOPILOT"`, an intent filter with the action name, and the same `<permission>` and `<uses-permission>` lines as a share. A link action is an `<activity>`: the audit flags an exported `<service>` or `<receiver>` with a link action filter, an `<activity-alias>` of a link action without the permission (an alias carries its own permission and replaces the target's), and a `<path-permission>` inside a link provider.
- Guard the caller of an action. The manifest `android:permission` (signature level, enforced by Android) is the gate. The usable second check inside the activity is `getCallingPackage()`, which is set only when the caller used `startActivityForResult`; then `packageManager.checkSignatures(callingPackage, packageName)` must be `SIGNATURE_MATCH`. Never use `getReferrer()` for security: the caller controls it. `getLaunchedFromUid` needs API 34 and the sender opting in. `AppLinkCaller` does not work here (below). The second check is built: copy `android/AppLinkActivityCaller.kt` in and call it first in `onCreate` (see "Second caller check for actions").
- Validate the extras before using them: `validateExtras(OPEN_NOTE, raw)` in TypeScript, `AppLinkGuard.validateExtras(spec, raw)` in Kotlin (`raw` is the intent's extras as a map). Both return a rejection with a reason instead of throwing, and an unknown extra, a NUL character, a wrong type or an over-limit value is rejected.
- Answer with an `ActionResult`: `{ status: 'done' | 'cancelled' | 'failed', code?, message? }`. `code` is lowercase letters, digits and underscores (at most 40). `message` is plain words for the user, at most 200 characters, never a raw error. `validateResult` checks it.

Limits (`fixtures/limits.json`, equal in TypeScript and Kotlin):

| Limit | Value |
|---|---|
| Extras per action | 8 |
| Characters in one string extra | 2000 (an action may lower it with `max`) |
| Items in a string-array extra | 20 |
| Characters in one array item | 200 |
| Characters in all string extras together | 8000 |
| Characters in a result message | 200 |
| Rows in a share | 200 by default, 500 at most |

Lengths count UTF-16 units, as Kotlin's `String.length` does. A `long` extra must be within JavaScript's safe integer range on both sides. Kotlin also accepts a `Double` that is a whole number in that range for a `long` extra (the React Native bridge sends every number as a Double) and returns it as a `Long`; TypeScript sees the same number as a JS number.

Deputy's `RunSuggestionActivity` is the one grandfathered headless action (ruling R5). It is `Theme.NoDisplay` and shows only a toast. It is meant to be started only by Inflow's Run tap, but any app signed with the same key can start it: its extras are not validated and `lookIn` is unbounded. When Deputy is next touched it should check `callingPackage` and validate its extras; that is an owner decision and is not done here. New actions must not copy it. `auditManifest(xml, { allowHeadless: ['expo.modules.deputyagent.android.RunSuggestionActivity'] })` is how it is exempted; without that option the audit flags it. It does not call `AppLinkCaller`; its only gate today is the manifest permission.

## App health share

Every app that serves links also serves one row about itself at `content://<authority>/health` (`appHealthShare(app)` in `src/health.ts`). The Store reads it for its health screen.

| Column | Type | Value |
|---|---|---|
| `app_id` | string | the release app id (`deputy`, `pdf-editor`, ...) |
| `accessibility` | int? | 1 on, 0 off, null when the app has no accessibility service |
| `listener` | int? | 1 on, 0 off, null when the app has no notification listener |
| `ai_source` | string | `hub` (AI hub), `own` (a key in the app) or `none`; read it with `parseAiSource`, which returns null for anything else |
| `last_seen_at` | long? | the app's own heartbeat (epoch ms) that it writes while it runs; a provider query only reads it, never updates it, so the reader learns when the app last ran, not when it was asked |

At most one row, no personal data. The column is `ai_source`, not `ai_key`: `key` as a word is a refused column name.

`appHealthShare` takes a release app id (`tools/release`) and looks the authority up in `HEALTH_AUTHORITIES`: a dashed id maps to one word (`pdf-editor` to `com.haroon.pdfeditor.applink`, `open-tunnel` to `opentunnel`, `design-editor` to `designeditor`, `ai-hub` to `aihub`), `netlens` uses `com.haroon.netlens.applink` although its package is `app.netlens`, and Inflow keeps its legacy authority `com.haroon.inflow.autopilot`, so its existing provider adds a `health` path. Nexus lives inside Design Editor and shares its row. The Store and `notch` serve none; any other id throws.

**Who serves it.** Each app that adds a health row follows "Add a share" with this share, and binds its provider in a JVM test to `fixtures/app-health.share.json` (`{ path, columns, maxRows }`; the authority is per app, so it is not in the file). `fixtures/app-health-rows.sample.json` holds sample rows for `assertRowShape`.

**What the Store shows.** The Settings.Secure value first (the Store can read every app's accessibility and listener state itself) and the app's row second. When the two disagree it shows "Not sure". A missing or refused row (a debug build, or an app that has no health row yet) leaves only the Settings.Secure value.

## Second caller check for actions

`android/AppLinkActivityCaller.kt` is the third canonical copy-in file (same rules as the guard: only the `package` line changes, `copies.test.ts` fails on drift). The pure decision `allowedActivityCaller(callingPackage, signaturesMatch)` allows only a non-empty calling package whose certificate matches this app's. `allowed(activity)` is the glue: it reads `Activity.getCallingPackage()` and `PackageManager.checkSignatures(callingPackage, packageName) == SIGNATURE_MATCH`, and any failure counts as "not allowed". The TypeScript twin `allowedActivityCaller` in `src/caller.ts` and the Kotlin one both read `fixtures/activity-caller-decisions.json`; an app that copies the file in adds a JVM test over the same fixture.

```kotlin
override fun onCreate(savedInstanceState: Bundle?) {
  super.onCreate(savedInstanceState)
  if (!AppLinkActivityCaller.allowed(this)) { setResult(RESULT_CANCELED); finish(); return }
  // validate extras, then show the screen
}
```

**When it works.** Only when the caller started the action with `startActivityForResult` from one of its Activities: Android then sets `callingPackage` to the caller's package, and the caller cannot fake it. Keep the action's launch mode the default.

**When it cannot work.** A start from a service, a broadcast receiver, a notification's `PendingIntent` or a plain `startActivity` has no calling package, so the check refuses it. That is why every "Do with Deputy" or "Add to Inflow" button lives in an app screen, never in a notification, and why an action can never be started by a Deputy run (Deputy works from a service). Never use `getReferrer()` instead: the caller sets it.

## PROPOSE_TASK and ADD_TODO

Both are declared in `src/links.ts` with `defineAction`, so both are `screen: true` activities behind `com.haroon.permission.AUTOPILOT`, pass `auditManifest` (no `Theme.NoDisplay`) and run `AppLinkActivityCaller.allowed` first. Extra keys are camelCase (`dueAt`, not `due_at`): `defineAction` refuses `_` in a key.

**`com.haroon.deputy.action.PROPOSE_TASK`** opens Deputy's draft screen with a proposed task. Nothing runs until the owner starts it there, and Deputy's confirmation gate still stops anything that sends, pays, deletes or posts.

| Extra | Type | Limit |
|---|---|---|
| `task` | string, required | 300 |
| `context` | string | 2000. UNTRUSTED: other people's text or AI output. Deputy puts it only in the untrusted block, never in the instructions. |
| `apps` | string array | 20 items (package names) |
| `ref` | long | the caller's id for the item, a number only |

Results (`PROPOSE_TASK_RESULTS`): `{ status: 'done', code: 'handed_over' }` when the task is in Deputy's draft screen (not run), `{ status: 'cancelled', code: 'cancelled' }` when the owner backs out.

**`com.haroon.inflow.action.ADD_TODO`** opens Inflow with a filled-in to-do, saved only when the owner taps Add.

| Extra | Type | Limit |
|---|---|---|
| `title` | string, required | 200 |
| `dueAt` | long | epoch ms |
| `note` | string | 500 |
| `source` | string | 40 (the asking app, for display) |

Results (`ADD_TODO_RESULTS`): `{ status: 'done', code: 'added' }` or `{ status: 'cancelled', code: 'cancelled' }`.

Extras cases: `fixtures/propose-task-extras.json` and `fixtures/add-todo-extras.json`, in the shape of `extras-cases.json` (valid, at the limit, too long, wrong type, missing required, unknown key). `links.test.ts` runs them against the live specs and checks each row's `spec` equals the action's extras; Deputy's and Inflow's Kotlin tests run the same files through `AppLinkGuard.validateExtras`.

## CHANGED ping

`CHANGED_PING` is the broadcast `com.haroon.autopilot.CHANGED`, sent with an explicit package (`setPackage("com.haroon.halo")`; Halo only, and Android 8+ does not deliver an implicit broadcast to a manifest receiver anyway). It has no extras and never carries data: it only says "something changed", and Halo re-reads the shares, which keep their own guard. Send it with `sendBroadcast(intent, LINK_PERMISSION)` and declare Halo's receiver `exported="true"` with `android:permission="com.haroon.permission.AUTOPILOT"`, so only same-key apps can send or receive it. It is not a link action: its name has no `.action.` part, so `auditManifest` lets a receiver take it (a receiver with a link action filter is still flagged).

## Who answers: the reader rule and the sender rule

The guards above protect the app that is asked. They do not protect the app that asks: Android hands a read or an intent to whichever app holds the authority or the package name on this phone. An app that took a sibling's authority first, or a lookalike signed with the public debug key, would get the intent and its extras (and any URI grant), or feed the reader made-up rows. `android/AppLinkTarget.kt` checks the other end before anything is read or sent.

**Reader rule.** Every app that reads another app's share MUST call `AppLinkTarget.trustedProvider(context, authority, expectedPackage)` before it queries, every time (not once at start: an app can be replaced while ours runs). It passes only when `resolveContentProvider(authority, 0)` names exactly `expectedPackage` and `checkSignatures(context.packageName, expectedPackage) == SIGNATURE_MATCH`. False means "not installed, no data": never query, never show cached rows from it as fresh, never retry another way.

**Sender rule.** Every app that starts another app's activity or sends it a broadcast MUST make the intent explicit (`setPackage` or `setComponent`) and call `AppLinkTarget.trustedActivity(context, intent)` or `AppLinkTarget.trustedReceiver(context, intent)` first. False means "not installed": never send, never fall back to an implicit intent or a chooser.

- `trustedActivity` runs `queryIntentActivities(intent, MATCH_DEFAULT_ONLY)`: every activity found must sit in the intent's package, that package must be a sibling with our signature, and every one must require `com.haroon.permission.AUTOPILOT`. Pass `requireLinkPermission = false` only for a sibling activity that is not a link action (Design Editor's photos to Nexus go to Nexus's ordinary share screen); the package and signature checks still run.
- `trustedReceiver` runs `queryBroadcastReceivers(intent, 0)` with the same package and signature checks, and every receiver must require the link permission. Send with `sendBroadcast(intent, LINK_PERMISSION)` all the same: the check is about who is there now, the permission overload is what Android enforces on delivery.
- An intent with both a component and a package that disagree is refused.

**The decision.** `AppLinkTarget.decide(expectedPackage, resolvedPackage, signaturesMatch)` returns `Trusted`, `NotInstalled` (nothing resolved) or `Spoofed(reason)`: `UNKNOWN_SIBLING` (the expected package is not in `SiblingPackages`, so a typo or the Store never passes), `WRONG_PACKAGE` (another app answers; names compare exactly, case included) or `SIGNATURE_MISMATCH`. The TypeScript twin is `decideTarget` in `src/target.ts`; both read `fixtures/target-decisions.json`. The glue functions return a plain Boolean and count any exception as false.

**The sibling table.** `SiblingPackages` (Kotlin, in `AppLinkTarget.kt`) and `SIBLING_PACKAGES` (TypeScript) hold each app's package by release app id, and both equal `fixtures/sibling-packages.json`: HomeNet `app.netlens`, TunnelWall `com.opentunnel.open_tunnel_vpn`, Deputy `com.haroon.deputy`, Strongroom `com.haroon.strongroom`, Inflow `com.haroon.inflow`, Nexus `com.haroon.pdfeditor`, Clipboard `com.haroon.clipboard`, Halo `com.haroon.halo`, Design Editor `com.haroon.designeditor`, AI hub `com.haroon.aihub`. `target.test.ts` fails when the fixture, the TypeScript table, the Kotlin table, `ANDROID_PACKAGES` in `packages/store-manifest` or an app's `applicationId` disagree. A new sibling goes in all of them at once. Halo's `ProviderTrust` and Inflow's `SiblingIdentity` were earlier per-app versions of the reader check; on their branches `AppLinkTarget` replaces both. Inflow keeps a small `ProviderTrust` fun interface in `BriefingReaders.kt` only as a seam its tests fill in; the real check behind it is `AppLinkTarget.trustedProvider`.

**Package visibility.** On Android 11+ `resolveContentProvider`, `queryIntentActivities`, `queryBroadcastReceivers` and `checkSignatures` see only packages visible to the app, so without a `<queries>` entry every check answers "not installed" (fail closed, the link just stops). Declare `<queries><package android:name="..." /></queries>` for each sibling the app reads from or sends to, unless it already holds `QUERY_ALL_PACKAGES`. Not checked on a phone yet.

**API levels.** The int-flag overloads (`resolveContentProvider(String, int)`, `queryIntentActivities(Intent, int)`, `queryBroadcastReceivers(Intent, int)`) exist on every API level the apps support; the `ComponentInfoFlags` and `ResolveInfoFlags` overloads need API 33. In the android-36 `android.jar` the int overloads carry no deprecation attribute (`javap -v`), so no `@Suppress` is needed.

**Copy it in.**

1. Copy `android/AppLinkTarget.kt` into the module next to the other guard files (`android/src/main/java/<module package>/applink/`) and change only the `package` line. It is self-contained (its own `LINK_PERMISSION`, no other guard file needed).
2. Copy `android/AppLinkTargetTest.kt` to the same package under `android/src/test/java/` and change only the `package` line. It needs only `junit:junit` (no JSON library) and reads the fixtures five folders above the module's `android/` directory, like `AppLinkGuardTest`. Run it with `./gradlew :<module>:testDebugUnitTest`.
3. Add the `<queries>` entries above.
4. Wrap every read and send: `if (!AppLinkTarget.trustedProvider(context, authority, SiblingPackages.INFLOW)) return emptyList()` before `contentResolver.query`; `if (!AppLinkTarget.trustedActivity(activity, intent)) return "not_installed"` before `startActivityForResult`; `if (AppLinkTarget.trustedReceiver(context, intent)) context.sendBroadcast(intent, AppLinkTarget.LINK_PERMISSION)`.

`copies.test.ts` checks every copy of `AppLinkTarget.kt`, `AppLinkTargetTest.kt` and any file that declares `SiblingPackages`, like the other guard files.

The Kotlin side was checked without Gradle: both canonical files compiled with the Kotlin 2.2.21 compiler from the Gradle 9.3.1 distribution against the android-36 `android.jar` with `-Werror`, and `AppLinkTargetTest` ran under JUnit 4.13.2 from `apps/inflow/modules/inflow-core/android` (3 tests OK), as did a copy with only the `package` line changed. Two mutants (a case-insensitive package compare, a wrong package in the table) each failed it.

## Threat model

**Who can call.** A sibling signed with the same key. Two gates:

1. The manifest permission is signature level, so Android grants it only to apps signed like the one that declares it.
2. In a provider, `AppLinkCaller.allowed` re-checks the caller's signing certificate with `PackageManager.checkSignatures(callerUid, ownUid)` and also that the caller holds the permission. A squatter that declares the permission name first does not hold it as ours: on Android 5+ the real app's install then fails (`INSTALL_FAILED_DUPLICATE_PERMISSION`), so squatting is a denial of service, not a way in. The certificate check stays as defense against OEM or historical custom-permission bugs, and it does not rely on Android's refusal. Any failure to find out counts as "not allowed". A call from the app's own uid is allowed. The decision table is `fixtures/caller-decisions.json`, read by both `decideCaller` (TypeScript) and `AppLinkGuard.decide` (Kotlin).

**Actions have two gates when the caller asks for a result.** `AppLinkCaller` reads `Binder.getCallingUid()`, which is the app's own uid inside an `Activity.onCreate` (no binder call is in progress), so it would always answer "self, allowed". Use it in provider methods only. An action's first gate is its manifest `android:permission`; its second is `AppLinkActivityCaller.allowed(activity)`, which reads the system-set `callingPackage` and re-checks that package's certificate. That second gate only exists when the caller used `startActivityForResult` from an Activity, so an action that calls it refuses every start from a service, a notification or a plain `startActivity`. That is the trade: Deputy runs its tasks in a service, so a Deputy run can never start another app's action; buttons that start actions live in app screens.

**Who answers is checked by the asker.** A reader or sender trusts the other end only through `AppLinkTarget` (above): the app Android resolves to must be the expected sibling's package and carry our signing certificate. An app that took a sibling's authority or package name first (installed before the sibling, or a debug-signed lookalike) gets nothing and feeds nothing; the asking app treats the sibling as not installed. This relies on the same shared-key trust as the provider guard, so between two debug builds it protects nothing (see "Signing finding").

**The ping is not a gate.** `com.haroon.autopilot.CHANGED` carries no data. A same-key sibling (or, without the receiver permission, anyone) can only make Halo re-read shares it was going to read anyway, and each read still passes the provider's guard.

**The health share is not proof.** An app reports its own accessibility and listener state and its heartbeat; a compromised sibling can lie. The Store reads Settings.Secure first and treats the app's row as a second opinion.

**What can leak.** What a share declares is the names of its columns, at most 500 rows: `defineShare` refuses a sensitive column name (names only, never values), and the guarantee reaches a provider only when a JVM test binds that provider's column array and row cap to the share's fixture (Inflow's `AutopilotProviderShareTest.kt` does this for `suggestions`). Not covered by any share: Inflow's `items/#` (message text, served under `AutopilotAccess`) and its `update` path, which are undeclared legacy paths. No secret may be added to a share, an extra or a result. A provider fixes its columns and ignores a caller's projection, selection and sort arguments.

**What the guard does not cover.**

- A sibling app that is itself compromised: it holds the permission and the key, so it is let in.
- A rooted device.
- Manifest merging, `tools:` overrides and `@string/` references: `auditManifest` is a small text scanner and does not see them. Audit the source manifest of a module, not the merged one. An `android:exported` set by a resource reference (`@bool/...`) counts as exported.
- Whether a link action really shows a screen (see "Add an action").
- `AppLinkCaller` has no JVM test, because it needs a real binder. Its decision logic (`AppLinkGuard.decide`) is tested; the glue is covered only by the phone checks below. The same holds for `AppLinkActivityCaller.allowed`: `allowedActivityCaller` is tested against its fixture, the glue only on a phone.
- `AppLinkTarget`'s glue (`trustedProvider`, `trustedActivity`, `trustedReceiver`) needs a real `PackageManager`, so only `decide` and the sibling table have a JVM test; the glue is covered only by the phone checks below.
- Phone checks of the whole chain have not been run (below).

## The rule

- No secrets cross a link, ever: no passwords, tokens, keys, codes, vault items.
- Text that came from other people (messages, contact names, titles) is untrusted data in the receiving app, never instructions. In Deputy it goes in the untrusted block. Inflow's suggestion `title`, the source message text and `PROPOSE_TASK`'s `context` (which may also be AI output) are of this kind.
- A link never skips Deputy's confirmation gate for anything that sends, pays, deletes or posts.
- Nothing from another app starts anything without the user seeing a screen. Deputy's grandfathered `RunSuggestionActivity` is the one exception; it is meant to be started by the owner's tap on Run, but a same-key sibling can start it too (see "Add an action").

## Signing finding

All releases are signed with the one Store key (cert SHA-256 begins `e3af4a92`; the full value is in `docs/app-store.md`). `tools/release` (`release-android.ts`) builds with that key, runs `apksigner`, and refuses any APK whose signers are not exactly the pinned cert. Before it builds it patches each app's `android/app/build.gradle` with `applyAppsHubGradle`. What the tree shows:

- **(a) A plain build is not signed with the shared key unless the machine has it.** In every committed `android/app/build.gradle` except Inflow's, the release build type is `signingConfigs.findByName('release') ?: signingConfigs.debug`, and the `release` config exists only when the Gradle property `APPS_HUB_RELEASE_STORE_FILE` is set (from `~/.gradle/gradle.properties`). Without it, release falls back to `debug.keystore`; a debug build always uses it. All 11 apps carry the same `debug.keystore` (identical bytes; the public Expo debug key, alias `androiddebugkey`, password `android`). Consequences: an app built that way is refused (fail closed) by links from a Store-signed app, and two debug-built apps match each other, and so does any app signed with that public key, so the signature check protects nothing between debug builds.
- **(b) Inflow's committed gradle has no release signing block.** `apps/inflow/android/app/build.gradle` has only the `debug` signing config, and its release build type uses it. The release block is added at release time: `applyAppsHubGradle` returns without a patch only when the file already mentions `APPS_HUB_RELEASE_STORE_FILE`, and I ran it on Inflow's file and it patched without error. `tools/release` writes that patch into the working tree and it is not committed, so any Inflow build from a checkout that `tools/release` has not patched is debug-signed, whatever is in `~/.gradle/gradle.properties`.
- **(c) `apps/ai-hub` has a Store release path** (added in #71). It (`com.haroon.aihub`) is in `ANDROID_PACKAGES` in `packages/store-manifest/src/index.ts` and in `tools/release/src/apps.ts`, so the Store can install and update it and `tools/release` pins its signer like every other app. Signature trust holds for it only once it has been released through the Store.
- **(d) `notch` is in `ANDROID_PACKAGES` but has no app directory** (it was merged into Halo), so there is nothing to release under that id.
- **(e) The committed `debug.keystore` is a public key, the same in every app.** All 11 apps' `android/app/debug.keystore` files are byte-identical (the public React Native and Expo template key; alias `androiddebugkey`, password `android`), so anyone can sign an app with it. Signature trust therefore holds only between Store-installed release builds. A debug-signed build can talk to another debug-signed build and to a lookalike signed with the public key, but never to a Store-signed app. Releasing stays safe while `tools/release` refuses any APK whose signers are not exactly the pinned Store cert (`release-android.ts`), which also rejects a build that fell back to `debug.keystore`.

## Phone checks (not run)

The phone is used through the coord queue by the main session only.

1. Install Inflow and Deputy from Store releases. In Inflow open a reply suggestion and tap Run: Deputy starts the run as before.
2. With the phone connected, run `adb shell content query --uri content://com.haroon.inflow.autopilot/suggestions`. The shell uid does not hold the permission, so the query must fail with a `SecurityException` (a permission denial naming `com.haroon.permission.AUTOPILOT`). This exercises the manifest gate only; to see the Kotlin certificate check refuse a caller you need an app that holds the permission but is signed with another key, which Android should refuse to install in the first place.
3. Open Deputy: it still lists and reads Inflow's suggestions.
4. After an app adopts `AppLinkTarget`, with Store-signed siblings installed: its reads and sends work as before, and with the sibling uninstalled it says the sibling is not installed. The refusal of a lookalike signed with another key needs a non-Store install, which the owner does not allow on the phone; it is covered by `fixtures/target-decisions.json` only.

## Metro

Inflow imports only types from `autopilot-contract` today (`import type`), so Metro never resolves it at run time. `autopilot-contract` now imports `@apps-hub/app-link-contract` as a value (`defineShare`, `LINK_PERMISSION`). In this tree pnpm links it through `packages/autopilot-contract/node_modules/@apps-hub/app-link-contract`, and `apps/inflow/node_modules/@apps-hub` lists only `autopilot-contract` and `ui`. An app that imports runtime values should list `@apps-hub/app-link-contract` as its own dependency and run one Metro bundle to confirm. This was not verified with Metro here.

## Tests

```bash
pnpm --filter @apps-hub/app-link-contract test
pnpm --filter @apps-hub/app-link-contract typecheck
```

The Kotlin side, from the repo root, with `JAVA_HOME` and `ANDROID_HOME` set as in `docs/toolchain.md`:

```bash
cd apps/inflow/android && JAVA_HOME=$JAVA_HOME ./gradlew :inflow-core:testDebugUnitTest :app:assembleDebug
```
