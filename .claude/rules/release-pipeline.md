---
paths:
  - "tools/release/**"
  - "tools/store-api/**"
  - "apps/store/**"
  - "packages/store-manifest/**"
  - ".github/workflows/**"
---

# Store and release pipeline

Full setup, secrets and phone steps: `docs/app-store.md`.

- One Android signing key signs every app. The Store (`com.haroon.store`, native module `store-installer`) pins its cert via `SIGNING_CERT_SHA256` in `packages/store-manifest` and ignores whatever cert the manifest claims.
- `pnpm release` sets `versionCode` to the published manifest value + 1 and takes `versionName` from `app.json`. It passes both to Gradle as `-PappsHubVersionCode/-PappsHubVersionName`, so nothing in git changes. It then checks the signer and package with `apksigner`/`aapt2` before uploading, and refuses a debug-signed build.
- CI (`.github/workflows/ci.yml`) runs tests and typecheck on every push. A push to `main` also releases each Store app whose folder, native module or workspace dependency changed (`tools/release/src/changed.ts`, from pnpm's dependency graph), so a `packages/ui` change releases all four apps. `*.md`-only changes release nothing. Releases run one at a time because each rewrites `manifest.json`.
- Adding a releasable app: an entry in `tools/release/src/apps.ts`, plus its package in the `<queries>` list of `apps/store/modules/store-installer/android/src/main/AndroidManifest.xml`, then `pnpm release store`. Set `prebuild: true` only if `android/` is not committed; none are today.
- iOS has native projects (NetLens, OpenTunnel) but no distribution path, since there is no paid Apple account. `--platform ios` exits with an explanation.
