# apps-hub Toolchain (observed environment — 2026-10-25)

Verified facts for building every app in this monorepo. Values below are the
ACTUAL versions/paths observed on this machine (not assumptions).

## JavaScript
- Node: `v22.22.3` (nvm-managed, `~/.nvm/versions/node/v22.22.3/bin/node`).
- pnpm: `12.15.0` — pinned via root `packageManager` (corepack-managed);
  `corepack enable pnpm` + `corepack use pnpm@latest` was used once to pin.
- Linker mode: `node-linker=hoisted`, BUT pnpm ≥10 still uses a `.pnpm`
  virtual store per workspace app; each workspace package gets its own
  `node_modules` closure (workspace symlinks for `@apps-hub/*`,
  `netlens-core`). Metro uses the default resolver plus root `watchFolders`.

## Android
- JDK: Brew `openjdk@21` → `21.0.13.0.2`
- `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`
- Android SDK (brew cask `android-commandlinetools` 15859902):
  - `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`
  - Layout: `build-tools/ cmdline-tools/ licenses/ platform-tools/ platforms/ ndk/`
  - Installed: platform-tools r37.0.1, platforms;android-36, build-tools;36.0.0;
    NDK 27.1.12297006 is auto-installed by the first Gradle configure.
- NetLens Gradle (SDK 54 prebuild): wrapper Gradle `8.14.3`, Hermes enabled;
  the Expo version catalog pins compileSdk 36, minSdk 24, Kotlin `2.1.20`,
  KSP `2.1.20-2.0.1`.
- Note: brew's `android-commandlinetools` cask warns "requires Java" unless a
  JDK cask exists, but it actually installs fine after `brew install
  openjdk@21`; the `sdkmanager` binary is linked to
  `/opt/homebrew/bin/sdkmanager`.
- Kotlin gotchas (bit us): `Channel` lives in `kotlinx.coroutines.channels`,
  NOT `kotlinx.coroutines`; `java.net.InterfaceAddress.getNetworkPrefixLength()`
  returns `Short` — use `.toInt()`.

## iOS (NetLens)
- Xcode `26.5` (build 17F42) ✓
- CocoaPods `1.17.0` ✓ (homebrew pod; system ruby-free path)
- `pod install` runs inside `apps/netlens/ios` (Podfile + Podfile.properties.json
  are prebuild-generated).
- **Local-module pitfall (cost real time — do not lose):** expo's CocoaPods
  autolink drops modules whose podspec platform requirement is NEWER than the
  app's deployment target (`Platform#supports?` in the autolinking Ruby). The
  `create-expo-module` template podspec pins `:ios => '16.4'` while
  `Podfile.properties.json` defaults the app target to `15.1`, producing a
  silent `netlens-core doesn't support iOS platform`. Local module podspecs in
  this repo therefore pin `15.1`. The iOS 26.5 SDK also redesigned
  `NWBrowser` (Descriptor enum, struct `Result{endpoint, metadata}` — check the
  `.swiftinterface` under the SDK's Network.framework before using Network
  APIs), and `<net/route.h>` symbols (`rt_msghdr`, `RTF_GATEWAY`, `RTAX_*`)
  are NOT exposed to Swift; `NetworkInterfaceDetector.swift` mirrors the BSD
  layout for the sysctl route-dump parser.

## Environment variables (per shell, used by every Android build invocation)
```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
```

## Verification quick-start (NetLens Phase 1)
```bash
pnpm test
pnpm typecheck
pnpm --filter netlens exec expo-doctor
cd apps/netlens/android && JAVA_HOME=$JAVA_HOME ./gradlew :netlens-core:testDebugUnitTest :app:assembleDebug
cd ../ios && xcodebuild -workspace NetLens.xcworkspace -scheme NetLens \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -configuration Debug build CODE_SIGNING_ALLOWED=NO
```
