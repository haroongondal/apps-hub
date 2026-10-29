# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Deputy (`com.haroon.deputy`): a personal Android agent that carries out tasks by operating other apps through an AccessibilityService. Android only, distributed only through the private Store. Kotlin owns the agent loop and the confirmation gate; React Native only renders state.

Before starting work, read `docs/handoffs/deputy.md` ("Current state + exact next step"), then `docs/deputy/SPEC.md` §17 (build phases, one per session) and §18 (spikes). The handoff's file map and state may lag the code, so check the tree.

## Commands

```bash
pnpm --filter deputy test        # node --test, files listed in package.json
pnpm --filter deputy typecheck
cd apps/deputy/android && ./gradlew :deputy-agent:testDebugUnitTest :app:assembleDebug   # needs JAVA_HOME
```

## Structure

- `modules/deputy-agent` is the Expo module. Under `android/src/main/java/expo/modules/deputyagent/`, `core/` is pure Kotlin with no Android imports so it runs in JVM tests, and `android/` holds the platform code (`DeputyAccessibilityService`, `SpikeProbes`). Put new decision logic in `core/`.
- `modules/deputy-agent/src/index.ts` is the TS contract; the Kotlin module must match it.
- `src/setup.ts` is pure TS (the Setup screen's rows from `ServiceState`) and is the tested part of the UI.

## Rules

- The agent must never read or act on Deputy's own screens; the tree dump already refuses them. Keep that when adding probes.
- Don't register `deputy` in `tools/release/src/apps.ts` until a build is ready for the phone: CI releases every changed Store app on `main`.
- Install on the phone only through the Store, and only after the user agrees and the Cloudflare account is confirmed. Never write the user's Gemini key to a file, a log or the handoff.
- Work on a branch, not `main`, and commit only when asked.
