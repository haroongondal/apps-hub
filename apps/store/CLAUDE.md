# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The private Store (`com.haroon.store`, Android only): lists the apps in the manifest and installs and updates them, itself included. Pipeline, secrets and phone setup are in `docs/app-store.md`; the release rules load from `.claude/rules/release-pipeline.md`.

## Commands

```bash
pnpm --filter store test        # four files, listed in package.json
pnpm --filter store typecheck
cd apps/store/android && ./gradlew :store-installer:testDebugUnitTest :app:assembleDebug   # needs JAVA_HOME
```

Install builds on the phone through the Store itself (`pnpm release store`), not `adb install`. The Store is the installer of record, and `adb` skips the paths this app exists to exercise.

## Structure

- `src/api.ts`, `status.ts`, `present.ts` and `health.ts` are pure TypeScript with tests: manifest fetch and signed-URL calls, install status, display text, and the Setup and health checks (service table, Settings.Secure parsing, health-row validation, reconcile). `App.tsx` and `src/HealthScreen.tsx` are the UI over them; `manifest.test.ts` runs the link contract's `auditManifest` over the Store manifests.
- Install and update logic is Kotlin in `modules/store-installer`: `ApkVerifier`, `Installer`, `InstallWorker` (foreground WorkManager download), `UpdateCheckWorker`, `SelfUpdateReceiver` and `Credentials` (Keystore). `Health` reads Settings.Secure and the sibling apps' `health` rows (through `Deadline`, 3 s) and opens their settings pages. `ApkVerifierTest` and `DeadlineTest` are the JVM tests.

## Rules that are easy to break

- Verify before every install: SHA-256 of the file against the manifest, package name against the one compiled in for the tapped app id (`androidPackageFor`, `ANDROID_PACKAGES` in `packages/store-manifest`), and the signer against the cert pinned in the app (`SIGNING_CERT_SHA256`). The manifest's own package and cert fields are ignored for installs.
- A download that finishes while the app is in the background must not start the install. Play Protect's prompt would go unseen and the OS times out after about 17 s. Post a "ready to install" notification instead.
- Package visibility is `QUERY_ALL_PACKAGES` in the module's `AndroidManifest.xml` (owner decision, 2026-11-01), so reading a new app's installed version needs no Store change; installing it needs its `ANDROID_PACKAGES` entry and a Store release. Don't bring back a `<queries>` package list.
- Health rows are a second opinion: the phone's own Settings.Secure value wins, and every row goes through `parseHealthRow` before it is shown. The Store holds `com.haroon.permission.AUTOPILOT` (signature) only to read them; a debug-built Store will not install while a Store-signed app that declares it is on the phone (duplicate permission).
- Permissions are set in `app.json` (`blockedPermissions` strips the storage, vibrate and overlay ones). Keep the list minimal.
