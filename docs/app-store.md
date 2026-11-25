# Private app store

Personal sideload pipeline for apps in this monorepo. One Android signing key for every app, a one-command
release, and an Android **Store** app (`apps/store`, `com.haroon.store`) that installs and updates the others
and itself.

```
pnpm release <app>                 apps-hub-store Worker (Cloudflare)             Store app (Android)
  gradle assembleRelease  ──PUT /admin/*──▶  R2: apps/<id>/android/<vc>.apk  ◀──GET /f/*?exp&sig── PackageInstaller
  verify signer + badging                   R2: manifest.json  ◀──GET /manifest.json (Bearer)──── list + status
  upsert manifest.json                      POST /sign (Bearer) → 10-minute HMAC-signed URL ───▶ download
  by hand: PUT /admin/models/<sha256>       R2: models/<sha256>  ◀──GET /models/<sha256> (public)── apps fetching a model
```

| Piece | Path |
|---|---|
| Manifest schema, pinned cert (`SIGNING_CERT_SHA256`), app id → package table (`ANDROID_PACKAGES`) | `packages/store-manifest` |
| Release CLI | `tools/release` (`pnpm release`) |
| CI/CD (auto-release on push to `main`) | `.github/workflows/ci.yml`, `tools/release/src/changed.ts` |
| Worker: auth, signed URLs, uploads, and a public read-only `GET /models/<sha256>` for model files (the app checks each file's SHA-256; upload needs the release token) | `tools/store-api` |
| Store app + native module (`store-installer`) | `apps/store`, `apps/store/modules/store-installer` |

**iOS is not set up.** Ad hoc over-the-air installs and TestFlight both need a paid
[Apple Developer Program](https://developer.apple.com/programs/) membership. See [iOS (later)](#ios-later).

---

## 1. Machine setup (once per Mac)

### Android signing key

Every app is signed with one key so the Store can pin it:

| | |
|---|---|
| Keystore | `~/.config/apps-hub/release.jks` (PKCS12, RSA 4096, alias `apps-hub`) |
| Credentials | `~/.gradle/gradle.properties` (`APPS_HUB_RELEASE_*`), mode 600 |
| Cert SHA-256 | `e3af4a92b1e858ede650bf53521c9be86702036100b2dc07393a262748d0317d` |

> **Back up `release.jks` and the passwords** (e.g. in your password manager). If you lose them, every app has
> to be uninstalled and reinstalled with a new key, and the new cert must replace `SIGNING_CERT_SHA256`.

Restoring on a new Mac: copy `release.jks` to `~/.config/apps-hub/`, then recreate `~/.gradle/gradle.properties`:

```properties
APPS_HUB_RELEASE_STORE_FILE=/Users/<you>/.config/apps-hub/release.jks
APPS_HUB_RELEASE_STORE_PASSWORD=<password>
APPS_HUB_RELEASE_KEY_ALIAS=apps-hub
APPS_HUB_RELEASE_KEY_PASSWORD=<password>
```

Without that file, release builds fall back to the debug key. `pnpm release` refuses to publish those builds
because their signer doesn't match the pinned cert.

### Worker + bucket (once per Cloudflare account)

Run from `tools/store-api`, signed in with `cf auth login` to the account you want:

```bash
cf r2 buckets create --name apps-hub-store        # check flags with: cf r2 buckets create --help
# Three random secrets, stored only in this git-ignored file:
for k in STORE_TOKEN RELEASE_TOKEN SIGNING_KEY; do echo "$k=$(openssl rand -hex 32)"; done > .dev.vars
chmod 600 .dev.vars
pnpm run deploy                                    # = cf deploy --secrets-file .dev.vars
```

Then create `~/.config/apps-hub/release.env` (mode 600):

```bash
STORE_API_URL=https://apps-hub-store.<subdomain>.workers.dev
RELEASE_TOKEN=<RELEASE_TOKEN from .dev.vars>
```

| Secret | Who holds it | Can do |
|---|---|---|
| `STORE_TOKEN` | your phone (Store app, Keystore-encrypted) | read manifest, get signed download URLs |
| `RELEASE_TOKEN` | your Mac (`release.env`) | the above plus upload builds, the manifest and model files |
| `SIGNING_KEY` | Worker only | HMAC for download URLs (10-minute expiry) |

---

## 2. Release workflow

```bash
pnpm release netlens -m "What changed"     # one app: netlens | open-tunnel | pdf-editor | store
pnpm release store -m "Store fixes"        # the Store updates itself the same way
pnpm release --all -m "Rebuild everything"
```

For each app, the CLI:
1. Reads the live manifest and sets `versionCode` to the published value + 1. The same number is used for
   every platform, and `versionName` comes from the app's `app.json`. The numbers are passed to Gradle as
   `-PappsHubVersionCode/-PappsHubVersionName`, so nothing in git changes.
2. Runs `./gradlew :app:assembleRelease`.
3. Uses `apksigner` to check that the **only** signer is the pinned cert, and `aapt2` to check the package name and
   versionCode.
4. Uploads `apps/<id>/android/<versionCode>.apk`, then rewrites `manifest.json` (zod-validated, versionCode must
   strictly increase). The manifest is published after each app, so a later failure never leaves an upload half done.
   Cloudflare caps one request body near 100 MB (a 109 MB APK got `413 Payload Too Large`), so a file over 32 MB goes up
   in 32 MB parts through the Worker's multipart routes under `/admin/` (`POST ?uploads`, `PUT ?uploadId&part=N`,
   `POST ?uploadId` with `{parts}`). Deploy the Worker before the first release that needs it.

`--platform ios` exits with an explanation until iOS is set up.

### Release guard

Before anything is built, `pnpm release` runs `git fetch origin main` and refuses unless:
- `HEAD` is contained in `origin/main` (`git merge-base --is-ancestor HEAD origin/main`), and
- the working tree is clean (`git status --porcelain` is empty; untracked files count, git-ignored ones do not).

A failed fetch or a missing `origin/main` also refuses. Untracked files are always counted, whatever `status.showUntrackedFiles` says. This stops a branch build from replacing a main build in
the Store. For a test build, pass `--from-branch`: it skips both checks, prints a warning to stderr and starts the
changelog with `[branch build <short sha>]`. CI is not affected: it builds a pushed commit of `main` in a clean checkout.

### Rollback

`pnpm release <app> --rollback [--to <sha|tag>]` prints the plan for republishing an older build of one app and stops.
`pnpm release <app> --rollback --yes [--to <sha|tag>] [--accept-newer-data]` builds and publishes it.

- **A rollback is a new release, not a downgrade.** Android refuses to install an APK with a lower `versionCode` over
  a higher one ([versioning](https://developer.android.com/studio/publish/versioning)), and on a user build only the
  system server may override that for a non-debuggable app (`isDowngradePermitted` in AOSP
  [`PackageManagerServiceUtils.java`](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/pm/PackageManagerServiceUtils.java)),
  so neither `adb install -d` nor the Store can go back. The old commit is rebuilt with `versionCode` = published + 1;
  its `versionName` stays the old one. The changelog defaults to `Rollback to <versionName> (<short sha>)`.
- **Which commit.** Every release now records the full git sha it was built from in the manifest
  (`android.commit`; optional, releases made before this have none). The Store shows its first seven characters on the
  app's row as "Build from commit 8b8db0d", and hides the line when there is none. A rollback build also records
  `android.rolledBackFrom` (`versionCode`, `versionName` and `commit` of the release it replaced; optional, so old
  manifests parse and an older Store build drops it), and the row adds "Rolled back from 0.3.0 (41)" beside the commit
  line. The next normal release replaces the whole `android` entry, so the line goes away on its own. Without `--to`, the target is the first parent
  of the last commit that changed the app's folder (`apps/<app>`) at or before that recorded commit, that is, the app as
  it was just before its latest change. (The recorded commit alone is not enough: it can be a merge of another app's
  work, or one HEAD recorded for every app of an `--all` release.) `--to` takes a sha, short sha or tag. The target
  must be on `origin/main`, older than the current release, different from it, contain the app, and differ from the
  release commit inside the app's folder (otherwise there is nothing to roll back). Without a recorded commit and
  without `--to` it refuses. The manifest holds only the latest release per app, so there is no "previous
  versionName" lookup and `--to` does not take a versionName.
- **How it builds.** The usual release guard runs on your checkout. The target is checked out in a temporary
  `git worktree` (removed afterwards, also on Ctrl-C; a hard kill is cleaned up by `git worktree prune` on the next run), `pnpm install --frozen-lockfile --prefer-offline` runs there, then the normal
  steps (prepare, prebuild, gradle patch, `assembleRelease`, signer check, upload) run with that worktree as the root.
  Your own tree is never touched.
- **Plan first, `--yes` to go.** Without `--yes` a rollback only prints, then exits 0 without a worktree, build or upload
  (it still reads the manifest): `app`, `from` (commit and versionCode), `to commit`, `new versionCode`, `target` (Store
  host), what the Store gets (the new APK key, `manifest.json`, and how the row will read), the files that differ between
  the release being replaced and the target (those in the app's folder listed, the rest counted) and any database
  warning. `--dry-run` is still accepted and means the same as leaving `--yes` out; `--yes` with `--dry-run` is an error.
  `--yes`, `--accept-newer-data`, `--to` and `--dry-run` only work with `--rollback`.
- **Old code meets the newer database.** A rollback installs old code over the phone's newer on-device
  database. Android accepts the install because the `versionCode` is higher, but `SQLiteOpenHelper`'s default
  `onDowngrade` throws, so an app whose database schema version was raised after the target commit crashes on
  start until a forward release ships (Clipboard `clips.db` 1 to 2 added `pinned_at`; Strongroom `Schema.VERSION`).
  Inflow and HomeNet do not crash on a newer database, and Nexus throws its own `too_new` error, but the older code
  still cannot be trusted with data in a newer format, so they are treated the same way. The release tool therefore
  checks while it plans: `tools/release/src/schemas.ts` says, per app, where each database version
  lives (a number in Kotlin or TypeScript, or the count of a migration track's steps), and the tool reads it with
  `git show <sha>:<file>` at the target and at every commit whose data may be on the phones: the published commit and,
  when the published build was itself a rollback, the release it replaced (`android.rolledBackFrom.commit`; the higher
  schema counts, because an accepted rollback leaves the newer data on the phone). If the phones' version is higher, the
  rollback is refused with a plain message, with or without `--yes`, and nothing is built. When the tool cannot tell, it
  refuses too, but says "could not tell whether the data is newer" and names the database and the reason, instead of
  calling the data newer; fetch origin and run it again, or pass `--accept-newer-data` if you are sure. It cannot tell
  when a recorded commit is missing locally (never guessed from `HEAD`), when a file exists but its constant cannot be
  read, and when a registered file is missing at a commit although the app folder is there and the file was not simply
  created later: the tool follows the file's history (`git log --follow --diff-filter=A`) to the commit that first added
  it, and a commit strictly before that add means the database did not exist yet (fine, the old build never opens it),
  while any other case (a rename, a commit after the add, unreadable history) is "cannot tell". The same rule applies to
  the target and to the commits holding the phones' data. When the manifest records no commit at all, `HEAD` and
  `origin/main` are only a guess at what is published, so a target below the higher of the two is "cannot tell". A
  database is also absent when the app folder itself is absent at that commit. Nothing is wiped either way.
  `--accept-newer-data` overrides the refusal. It prints which databases are ahead and that the older app will not
  open that data until a newer release is installed (the rollback deletes nothing, but clearing the app's storage to
  recover would). It still needs `--yes` to build. Whether to offer this flag at all is the owner's call.
- **Keeping the registry honest.** `schemas.test.ts` fails when a registered constant no longer matches its source
  (a schema bump), and when any tracked file in `apps/` or `packages/` declares or opens a database
  (`SQLiteOpenHelper(`, `PRAGMA user_version =`, `SCHEMA_VERSION =`, `DB_VERSION =`, a `*_STEPS` migration list,
  `openDatabaseAsync(`, `openOrCreateDatabase(`) without being listed. A new app needs an entry (an empty one when it has no database).
- **A release that loses a race.** The build takes minutes. Just before the upload the tool re-reads the manifest and
  refuses to upload when another release took that `versionCode` while this one was building (it would overwrite that
  release's APK), saying to run it again. This closes the build-time window only: two releases that reach the upload
  within seconds of each other can still collide. The proper fix is a write-once APK key in `tools/store-api` (a Worker
  change that needs a deploy), not done here.
- A rollback with `--yes` builds and publishes. It replaces what every phone gets from the Store, so run it only
  on the owner's go.

```bash
pnpm release netlens --rollback                           # see the plan, change nothing
pnpm release netlens --rollback --yes -m "Back out the scan bug" # roll back to main before the released change
pnpm release netlens --rollback --to 1a2b3c4              # the plan for an explicit target
```

### CI/CD (automatic releases)

`.github/workflows/ci.yml` runs on GitHub Actions (free for this public repo):

- **Every push, any branch:** `pnpm test` and `pnpm typecheck`, then it prints which apps a release would include.
- **Push to `main`:** if the tests pass, it runs `pnpm release <apps> -m "<commit subject>"` for each Store app
  affected by the pushed commits. "Affected" comes from pnpm's dependency graph
  (`tools/release/src/changed.ts`): the app folder (including its native module in `apps/<app>/modules/`) or any
  workspace package the app depends on, e.g. `packages/ui` releases all four, `packages/core` only NetLens.
  Changes to `*.md` files alone release nothing. A release only reads the commit range of that push, so if
  one fails, re-run it from the Actions tab or use **Run workflow** with the app ids.
- **Manual:** Actions → CI → Run workflow, `apps` = `netlens open-tunnel pdf-editor store` (any subset). The field takes
  app ids only (lowercase letters, digits and dashes, none starting with a dash); anything else fails the run, so a flag
  such as `--rollback` or `--from-branch` cannot be passed through.

Releases run one at a time (`concurrency`), since each one rewrites `manifest.json`. Repository secrets
(Settings → Secrets and variables → Actions), copied from this Mac's files:

| Secret | Source |
|---|---|
| `APPS_HUB_RELEASE_KEYSTORE` | `base64 -i ~/.config/apps-hub/release.jks` |
| `APPS_HUB_RELEASE_STORE_PASSWORD`, `APPS_HUB_RELEASE_KEY_ALIAS`, `APPS_HUB_RELEASE_KEY_PASSWORD` | `~/.gradle/gradle.properties` |
| `STORE_API_URL`, `RELEASE_TOKEN` | `~/.config/apps-hub/release.env` |

After rotating `RELEASE_TOKEN` (section 4), update the GitHub secret too.

---

## 3. Android: first-time phone setup

1. **Sideload the Store once.** Build it with `pnpm release store` (or use the APK at
   `apps/store/android/app/build/outputs/apk/release/app-release.apk`) and install it with
   `adb install app-release.apk`, or open the file on the phone.
2. Open the Store and enter the **Server address** (the Worker API URL) and the **Device token** (`STORE_TOKEN`), then tap **Connect**. It checks them against the Worker before saving,
   then asks for notification permission.
3. Tap **Install** on any app. The first time, Android sends you to **Install unknown apps → Store → Allow**
   ([`REQUEST_INSTALL_PACKAGES`](https://developer.android.com/reference/android/Manifest.permission#REQUEST_INSTALL_PACKAGES)).
4. **Reinstall each existing app through the Store** so the Store becomes its *installer of record*:
   - If the old copy was signed with another key (every pre-Store build was: NetLens used the public Expo debug
     key, OpenTunnel your local debug key), the Store says *"Signed with a different key"*. **Uninstall it, then tap
     Install.** The app's data is lost once.
   - If the old copy has the right key but came from adb, it shows **Reinstall**. Tap it and confirm the prompt once.

After that, updates install **without a prompt** (Android 12+) as long as all of these hold
([`setRequireUserAction` docs](https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams#setRequireUserAction(int))):
- The Store is the installer of record (or update owner), or the Store is updating itself.
- The app's `targetSdk` is new enough for the phone's Android version: ≥ 34 on Android 16, ≥ 35 on the
  version after that. All apps currently target **36**. Google raises this bar every year, so keep the SDK current.
- Android may still return `PENDING_USER_ACTION`. The Store then opens the system confirmation dialog.

Background checks run through WorkManager on **unmetered networks** every 6 h by default (Off / 6 / 12 / 24 h in the
Store header). When an installed app is behind the manifest, you get a notification. Updates are not installed
in the background; tap the notification and then **Update**.

What the Store checks before every install: SHA-256 of the downloaded file = manifest, package name = the one
compiled into the Store for the app id you tapped (`ANDROID_PACKAGES`), signer = the **pinned** cert compiled into
the Store. It ignores whatever package and cert the manifest claims, and refuses an app id it doesn't know
("Update Store, then try again"). It does not stop an older build of an app that isn't installed yet: Android
refuses downgrades only for installed apps.

Store permissions: `INTERNET`, `REQUEST_INSTALL_PACKAGES`, `UPDATE_PACKAGES_WITHOUT_USER_ACTION`,
`POST_NOTIFICATIONS`, `QUERY_ALL_PACKAGES`, plus `WAKE_LOCK`, `ACCESS_NETWORK_STATE` and `RECEIVE_BOOT_COMPLETED`, which WorkManager merges in
so its scheduling keeps working. `QUERY_ALL_PACKAGES` lets the Store read the installed version of every app it
lists ([package visibility](https://developer.android.com/training/package-visibility)). It replaced a per-app
`<queries>` list on 2026-11-01: a new app went unseen until someone added it, and a Store release from an older branch
dropped entries. Play restricts this permission; the Store is sideloaded only. `ANDROID_PACKAGES` (security fix,
2026-11-06) brings a narrower form of that trade-off back on purpose: a Store built from a branch that lacks a newer
app's id still lists the app but refuses to install it until a newer Store is released. That is the price of a
compromised Worker or `RELEASE_TOKEN` no longer choosing which of your apps a tap installs.

---

## 4. Token rotation

1. In `tools/store-api/.dev.vars`, replace `STORE_TOKEN` and/or `RELEASE_TOKEN` (`openssl rand -hex 32`).
   Rotating `SIGNING_KEY` only invalidates download links that haven't expired yet.
2. `pnpm run deploy` (from `tools/store-api`).
3. New `RELEASE_TOKEN` → update `~/.config/apps-hub/release.env` and the `RELEASE_TOKEN` GitHub secret
   (`gh secret set RELEASE_TOKEN`).
   New `STORE_TOKEN` → in the Store tap **Sign out** and enter the new token.

---

## 5. Adding a new app

1. The app must be an Expo/RN app with a version in `app.json` and an `android.package`.
2. Add its release id → `android.package` to `ANDROID_PACKAGES` in `packages/store-manifest/src/index.ts`, then
   add it to `tools/release/src/apps.ts` with `packageName: ANDROID_PACKAGES[<id>]`:
   - `dir` is workspace-relative (or absolute for an app outside this repo).
   - `prebuild: true` if `android/` is not committed. The release then runs `expo prebuild --clean` each time.
   - `prepare` lists commands to run in `dir` before building (pdf-editor builds its editor bundle this way).
   You don't edit Gradle by hand. Each release patches `android/app/build.gradle` with the shared signing key and
   the `appsHubVersion*` overrides (`applyAppsHubGradle`, which does nothing if they're already there), and fails
   loudly if the file has drifted from the Expo template.
3. `pnpm release store` first: the Store installs only ids compiled into it. A push to `main` that changes
   `packages/store-manifest` releases the Store automatically. Then `pnpm release <app>`. The Store reads its
   installed version with no further change (`QUERY_ALL_PACKAGES`, §3).

---

## 6. Notes

### Google Play Protect
Play Protect scans apps installed from outside Play, may ask to send unknown apps to Google for scanning, and can
warn about, disable or remove apps it considers harmful ([help](https://support.google.com/googleplay/answer/2812853)).
Expect a "scan app?" prompt the first time each app is installed. Keep Play Protect on.
Android only waits about 17 s (`settings get global verifier_timeout`) for that prompt. Tap **Scan app** promptly; "Install
without scanning" also asks for a fingerprint and on a Xiaomi (Android 16) usually ran out of time, aborting the
install. The Store then says so and keeps the verified download, so tapping Update again goes straight back to the
prompt without downloading again. Install through the Store, not `adb install`, so these paths stay tested.

### Downloads
Store 7+ downloads in a WorkManager foreground job (`InstallWorker`, type `dataSync`) with a progress notification,
so locking the screen or switching apps does not stop it, and a reopened Store shows the running download. If the
download finishes while the Store is in the background, it does not start the install (Play Protect's prompt would
go unseen and time out); it posts "ready to install" and waits for the user to tap Update.

### Setup and health
The **Setup and health** row opens a screen with one card per installed app (every id in `ANDROID_PACKAGES`
except `store` and `notch`, found by package, so HomeNet and TunnelWall count). Pure logic and its tests:
`apps/store/src/health.ts`; native reader: `Health.kt` in `store-installer`.

- **Accessibility** (Deputy, Clipboard, Halo) and **Notification access** (Halo, Inflow): the Store reads
  `Settings.Secure` itself (`enabled_accessibility_services`, `enabled_notification_listeners`) and matches the
  component names in the `SERVICES` table; a test checks that table against each app's manifest. An unset
  accessibility key is "off"; a missing or refused listener key is "unknown", never "off".
- **The app's own report**: the `health` share from `@apps-hub/app-link-contract`, queried for each app on a
  background thread with a 3 s limit. The Store declares `com.haroon.permission.AUTOPILOT` (signature) and
  holds it; `QUERY_ALL_PACKAGES` already makes every provider visible, so it needs no `<queries>` entry.
  Before each query `AppLinkTarget.trustedProvider` (canonical copy in `store-installer/.../applink/`) checks who
  serves the authority: it must be the sibling package that `SiblingPackages` lists for the release id (JS passes
  the id, not a package) and carry the Store's signing key, otherwise no query. An id with no table entry
  (notch) is "Not reported". `HealthTest` covers the refusal; the Store has no sender.
  `parseHealthRow` checks each row (one row, the right `app_id`, flags 0, 1 or null, `ai_source` hub, own or
  none, a heartbeat after 2024 and not in the future); anything else, a debug build refused by the signature
  check, or an app without the share yet, shows "Not reported".
- **Reconcile**: the phone's setting first, the app's report second; when both are known and differ the card
  says "not sure". The report also gives the AI line (from AI hub, own key, none).
- **Autostart** cannot be read, so apps with a background service get a "Keep it running" card with the
  HyperOS steps and **Open app settings** (`ACTION_APPLICATION_DETAILS_SETTINGS`). Fix buttons open the
  accessibility list (the per-service page is not public SDK) or the app's notification access page
  (`ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS`, Android 11+, falling back to the list).

### Android developer verification checklist
Since **30 Sep 2026**, certified devices in Brazil, Indonesia, Singapore and Thailand only install or update apps
whose package names are registered by a verified developer. Google says the requirement goes **global in 2027**.
`adb` installs and an "advanced flow" remain available for unregistered apps
([overview](https://developer.android.com/developer-verification),
[FAQ](https://developer.android.com/developer-verification/guides/faq)).

- [ ] Create a free **limited distribution** account (personal use, up to 20 devices you authorize, no government ID;
      needs a Google account with 2-Step Verification and a payments profile):
      [guide](https://developer.android.com/developer-verification/guides/limited-distribution).
- [ ] Register each package name, following the Console's own instructions for proving key ownership:
  - `com.haroon.store`
  - `app.netlens`
  - `com.opentunnel.open_tunnel_vpn`
  - `com.haroon.pdfeditor`
  - `com.haroon.deputy` (once it is released)
  - `com.haroon.designeditor` (once it is released)
  - `com.haroon.inflow` (once it is released)
- [ ] Signing cert SHA-256 for all of them: `e3af4a92b1e858ede650bf53521c9be86702036100b2dc07393a262748d0317d`.
      A signed APK from `pnpm release` is in `<app>/android/app/build/outputs/apk/release/`.
- [ ] Authorize your phone in the Console as one of the 20 devices.
- [ ] Re-check this list each time a new app is added.

### iOS (later)
Needs a paid Apple Developer Program membership. Once you have it:
- Register the iPhone's UDID ([register a device](https://developer.apple.com/help/account/devices/register-a-single-device)),
  then create or regenerate an **ad hoc** profile per bundle ID
  ([ad hoc profiles](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile)).
  Profiles must be regenerated after adding a device and expire after a year.
- OTA install flow: [Distributing your app to registered devices](https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices).
  The Worker would serve `manifest.plist` dynamically with a fresh signed IPA URL inside it, because a static
  plist would contain an expired link.
- [Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device) must be
  enabled on the iPhone for ad hoc builds.
- TestFlight builds expire after 90 days ([overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview)).
- The manifest schema already has an optional `ios` block, so adding iOS doesn't change the format.
