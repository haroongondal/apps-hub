---
name: upgrading-dependencies
description: Use when adding, upgrading, removing or auditing an npm, Gradle or CocoaPods dependency in this pnpm/Expo monorepo, when pnpm refuses an install (ERR_PNPM_IGNORED_BUILDS, a version too new to install, a lockfile mismatch), when expo-doctor reports version mismatches, or when an advisory or a security scan asks for a version bump.
---

# Upgrading dependencies

Every app here must stay F-Droid pure FOSS, and the Expo SDK pins most React Native versions. Work
with those rules, never around them.

## Rules

- **New dependencies need the owner's approval** before they are added. Name the package, the version,
  its license, why nothing already installed does the job, and its install scripts.
- **FOSS only.** No Firebase, Google Play Services, closed-source SDK, analytics, crash reporter or
  remote logging, including transitive Gradle or CocoaPods dependencies pulled in by an Expo module.
  Check the license of the package and of anything native it links.
- **Expo owns the RN versions.** React Native 0.81.x, React and every `expo-*` package follow Expo
  SDK 54: add them with `pnpm --filter <app> exec expo install <pkg>`, not a bare `pnpm add`, and
  confirm with `pnpm doctor`. TypeScript stays 5.9.x; Node >= 22; `packageManager` stays the pinned
  pnpm in the root `package.json`.
- **Build scripts** are blocked until listed under `allowBuilds` in `pnpm-workspace.yaml`. Today:
  `workerd`. A new `true` entry needs the owner's approval like a new dependency.
- **Package boundaries survive upgrades:** `packages/*` stay free of React, React Native and Expo;
  `open-tunnel-core` runtime code stays Hermes-safe (no `node:crypto`, `Buffer`, `TextDecoder`).
- **Native toolchain** (JDK 21, compileSdk 36, Kotlin from the Expo version catalog, Xcode, CocoaPods)
  is recorded in `docs/toolchain.md`; update it when you change one. Local module podspecs pin iOS
  `15.1` (see the pitfall in `docs/toolchain.md`).

## Steps

1. One concern per change: one package, or one tightly coupled family (`expo-*` for an SDK bump,
   `@types/*`).
2. Read the changelog between the two versions for breaking changes, and check advisories
   (`pnpm audit --prod`, or the supply-chain-risk-auditor skill for a deeper look).
3. Add or bump (`expo install` for Expo-managed packages, otherwise `pnpm --filter <pkg> add
   <dep>@<range>`), then `pnpm install` and confirm the lockfile changed only where expected
   (`git diff --stat pnpm-lock.yaml`).
4. Verify: `pnpm test`, `pnpm typecheck`, `pnpm doctor`, and the native gate of every app the
   dependency reaches (`.claude/agents/repo-verifier.md` lists them). A native dependency needs the
   Android build and, for NetLens, the iOS simulator build.
5. Commit as `chore(<pkg>): upgrade <dep> to <version>` (or `chore(repo):` for root tooling), staging
   `package.json` files and `pnpm-lock.yaml` by name.

## When it fails

| Symptom | Cause | Fix |
|---|---|---|
| `ERR_PNPM_IGNORED_BUILDS` | A dependency needs its install script | A `true` entry needs the owner's approval; record `false` for a cosmetic script |
| No matching version, or one "too new" | A release-age policy (pnpm default or config) | Wait, or pin the previous release; never add an exclusion |
| expo-doctor reports a mismatch | Version outside what SDK 54 expects | `pnpm --filter <app> exec expo install --fix` |
| Metro cannot resolve a workspace package | Hoisting or `watchFolders` | Check `.npmrc` (`node-linker=hoisted`) and the app's `metro.config.js` |
| iOS module silently not linked | Podspec platform newer than the app target | Pin the podspec to `15.1` (`docs/toolchain.md`) |
| Gradle fails after a Kotlin bump | Kotlin or KSP outside the Expo catalog | Return to the catalog's versions |
