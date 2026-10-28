# Private app store

Personal sideload pipeline for apps in this monorepo. One Android signing key for every app, a one-command
release, and an Android **Store** app (`apps/store`, `com.haroon.store`) that installs and updates the others
and itself.

```
pnpm release <app>                 apps-hub-store Worker (Cloudflare)             Store app (Android)
  gradle assembleRelease  ──PUT /admin/*──▶  R2: apps/<id>/android/<vc>.apk  ◀──GET /f/*?exp&sig── PackageInstaller
  verify signer + badging                   R2: manifest.json  ◀──GET /manifest.json (Bearer)──── list + status
  upsert manifest.json                      POST /sign (Bearer) → 10-minute HMAC-signed URL ───▶ download
```

| Piece | Path |
|---|---|
| Manifest schema + pinned cert (`SIGNING_CERT_SHA256`) | `packages/store-manifest` |
| Release CLI | `tools/release` (`pnpm release`) |
| CI/CD (auto-release on push to `main`) | `.github/workflows/ci.yml`, `tools/release/src/changed.ts` |
| Worker: auth, signed URLs, uploads | `tools/store-api` |
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
| `RELEASE_TOKEN` | your Mac (`release.env`) | the above plus upload builds and the manifest |
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

`--platform ios` exits with an explanation until iOS is set up.

### CI/CD (automatic releases)

`.github/workflows/ci.yml` runs on GitHub Actions (free for this public repo):

- **Every push, any branch:** `pnpm test` and `pnpm typecheck`, then it prints which apps a release would include.
- **Push to `main`:** if the tests pass, it runs `pnpm release <apps> -m "<commit subject>"` for each Store app
  affected by the pushed commits. "Affected" comes from pnpm's dependency graph
  (`tools/release/src/changed.ts`): the app folder (including its native module in `apps/<app>/modules/`) or any
  workspace package the app depends on, e.g. `packages/ui` releases all four, `packages/core` only NetLens.
  Changes to `*.md` files alone release nothing. A release only reads the commit range of that push, so if
  one fails, re-run it from the Actions tab or use **Run workflow** with the app ids.
- **Manual:** Actions → CI → Run workflow, `apps` = `netlens open-tunnel pdf-editor store` (any subset).

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

What the Store checks before every install: SHA-256 of the downloaded file = manifest, package name = manifest,
signer = the **pinned** cert compiled into the Store (it ignores whatever cert the manifest claims).

Store permissions: `INTERNET`, `REQUEST_INSTALL_PACKAGES`, `UPDATE_PACKAGES_WITHOUT_USER_ACTION`,
`POST_NOTIFICATIONS`, plus `WAKE_LOCK`, `ACCESS_NETWORK_STATE` and `RECEIVE_BOOT_COMPLETED`, which WorkManager merges in
so its scheduling keeps working. Package visibility uses a `<queries>` list
([docs](https://developer.android.com/training/package-visibility)), not `QUERY_ALL_PACKAGES`.

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
2. Add it to `tools/release/src/apps.ts`:
   - `dir` is workspace-relative (or absolute for an app outside this repo).
   - `prebuild: true` if `android/` is not committed. The release then runs `expo prebuild --clean` each time.
   - `prepare` lists commands to run in `dir` before building (pdf-editor builds its editor bundle this way).
   You don't edit Gradle by hand. Each release patches `android/app/build.gradle` with the shared signing key and
   the `appsHubVersion*` overrides (`applyAppsHubGradle`, which does nothing if they're already there), and fails
   loudly if the file has drifted from the Expo template.
3. Add its package to `<queries>` in `apps/store/modules/store-installer/android/src/main/AndroidManifest.xml`,
   then `pnpm release store` so the Store can see it.
4. `pnpm release <app>`.

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
