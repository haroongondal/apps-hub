# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The private Store (`com.haroon.store`, Android only): lists the apps in the manifest and installs and updates them, itself included. Pipeline, secrets and phone setup are in `docs/app-store.md`; the release rules load from `.claude/rules/release-pipeline.md`.

## Commands

```bash
pnpm --filter store test        # two files, listed in package.json
pnpm --filter store typecheck
cd apps/store/android && ./gradlew :store-installer:testDebugUnitTest :app:assembleDebug   # needs JAVA_HOME
```

Install builds on the phone through the Store itself (`pnpm release store`), not `adb install`. The Store is the installer of record, and `adb` skips the paths this app exists to exercise.

## Structure

- `src/api.ts`, `status.ts` and `present.ts` are pure TypeScript with tests: manifest fetch and signed-URL calls, install status, and display text. `App.tsx` is the UI over them.
- Install and update logic is Kotlin in `modules/store-installer`: `ApkVerifier`, `Installer`, `InstallWorker` (foreground WorkManager download), `UpdateCheckWorker`, `SelfUpdateReceiver` and `Credentials` (Keystore). `ApkVerifierTest` is the JVM test.

## Rules that are easy to break

- Verify before every install: SHA-256 of the file against the manifest, package name against the manifest, and the signer against the cert pinned in the app (`SIGNING_CERT_SHA256`). The manifest's own cert field is ignored.
- A download that finishes while the app is in the background must not start the install. Play Protect's prompt would go unseen and the OS times out after about 17 s. Post a "ready to install" notification instead.
- Package visibility uses the `<queries>` list in the module's `AndroidManifest.xml`, not `QUERY_ALL_PACKAGES`. A new app must be added there.
- Permissions are set in `app.json` (`blockedPermissions` strips the storage, vibrate and overlay ones). Keep the list minimal.
