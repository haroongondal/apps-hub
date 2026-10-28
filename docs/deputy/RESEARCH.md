# Deputy — research: an on-phone AI agent that operates your Android phone

Working name **Deputy** (rename freely before Phase 1; nothing is scaffolded
yet). Researched 2026-10-28. Facts marked **verified** were checked against the
installed SDKs in this repo; everything else comes from the linked sources and
is marked where sources conflict.

---

## 1. Verdict

| Platform    | Feasible?                                     | Why                                                                                                                                                                                                                                                                                                                       |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Android** | **Yes, fully**, for a personal sideloaded app | Android's AccessibilityService can read every app's screen, take screenshots, tap, swipe, type and press Back/Home. That is the same mechanism DroidRun, minitap and Open-AutoGLM use. Sideloading through our Store avoids every Play Store policy that would forbid it.                                                 |
| **iOS**     | **No**, not for the core idea                 | iOS has no API that lets one app see or operate another. Agents can only call actions that apps publish through App Intents/Shortcuts. You also have no paid Apple Developer account, so the app would need re-signing every 7 days (see `docs/app-store.md`). §9 explains what a cut-down iOS app could and couldn't do. |

---

## 2. How an app can control Android: the options

| Mechanism                        | What it gives                                                                   | Cost to the user                                                                                                                                                                                                                | Use in Deputy                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AccessibilityService**         | Read the UI tree of every window, screenshots, gestures, global actions, typing | Toggle once in Settings → Accessibility (plus "Allow restricted settings" on some installs, §4)                                                                                                                                 | **Core.** No root, no PC, survives reboots.                                                                                                               |
| **Shizuku / wireless ADB**       | Shell-level control: `input`, `am start`, `pm grant`, `settings put`            | Needs re-starting after every reboot on unrooted phones ([Shizuku manual](https://shizuku.rikka.app/guide/setup.html))                                                                                                          | **Not needed.** One-off `adb shell pm grant … WRITE_SECURE_SETTINGS` (persists across reboots) is enough for the one thing ADB adds (§4, auto re-enable). |
| Root (Magisk)                    | Everything                                                                      | Unlock bootloader, wipes phone, breaks banking apps                                                                                                                                                                             | No                                                                                                                                                        |
| MediaProjection (screen capture) | Screenshots only, with a consent prompt each session                            | Annoying prompt                                                                                                                                                                                                                 | No. The accessibility screenshot API covers it.                                                                                                           |
| AppFunctions (Android 16/17)     | Apps publish callable functions, MCP-like                                       | Only apps that opt in. Google is working with a small group of developers and Gemini is the main caller ([Android Developers Blog](https://android-developers.googleblog.com/2026/02/the-intelligent-os-making-ai-agents.html)) | Later, if a callable API for third-party agents ships. Not in v1.                                                                                         |
| UI Automator / instrumentation   | Test-grade control                                                              | Requires a PC with ADB per session                                                                                                                                                                                              | No                                                                                                                                                        |

### Accessibility APIs Deputy needs (**verified** in `platforms;android-36/android.jar`)

| Need                                                         | API                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read the screen as structured data                           | `getWindows()` / `getWindowsOnAllDisplays()` + `AccessibilityNodeInfo` tree; `FLAG_RETRIEVE_INTERACTIVE_WINDOWS`                                                                                                                 |
| Screenshot                                                   | `takeScreenshot(displayId, executor, callback)` (API 30+), `takeScreenshotOfWindow(...)` (API 34+)                                                                                                                               |
| Screenshot failures to handle                                | `ERROR_TAKE_SCREENSHOT_SECURE_WINDOW` (FLAG_SECURE apps such as banking and some messengers return black/refused), `ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT` (rate limit)                                                      |
| Tap / long-press / swipe / scroll                            | `dispatchGesture(GestureDescription, …)`, or node actions `ACTION_CLICK`, `ACTION_SCROLL_FORWARD`                                                                                                                                |
| Back / Home / Recents / notification shade / lock            | `performGlobalAction(GLOBAL_ACTION_BACK, _HOME, _RECENTS, _NOTIFICATIONS, _LOCK_SCREEN)`                                                                                                                                         |
| Type text                                                    | `ACTION_SET_TEXT` on the focused field. Fallback for custom inputs (Flutter, WebView, games): `FLAG_INPUT_METHOD_EDITOR` + `getInputMethod().getCurrentInputConnection().commitText(...)` / `performEditorAction(...)` (API 33+) |
| Overlay (status + Stop button) without `SYSTEM_ALERT_WINDOW` | `TYPE_ACCESSIBILITY_OVERLAY` window owned by the service                                                                                                                                                                         |
| Keep running with the app in the background                  | Foreground service type `specialUse` (`FOREGROUND_SERVICE_TYPE_SPECIAL_USE`, **verified**), already used by OpenTunnel                                                                                                           |
| Turn itself off                                              | `disableSelf()`                                                                                                                                                                                                                  |

Launching apps by name uses `PackageManager` + launch intents. Deep links
(`tel:`, `sms:`, `https:`, `geo:`, `mailto:`) use plain intents, which skips
most of the tapping.

---

## 3. Prior art (what to copy, what to skip)

| Project                                                                             | Approach                                                                                                                                                                                                   | Take from it                                                                                       |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **DroidRun / Mobilerun Portal** ([docs](https://docs.mobilerun.ai/droidrun-portal)) | Accessibility-service "Portal" app exports an indexed UI tree. The agent (on a PC, any LLM) picks elements by index. Self-reported AndroidWorld scores from 63% to 91%, unverified                         | Indexed-element observation ("tap #14") beats raw pixel coordinates for reliability and token cost |
| **minitap mobile-use** ([benchmark](https://minitap.ai/benchmark))                  | Multi-agent planner/executor; claims top open-source AndroidWorld results (self-reported)                                                                                                                  | Separate "plan" from "act" only if single-loop quality proves insufficient. Start single-loop.     |
| **Open-AutoGLM** (Zhipu, Dec 2025)                                                  | Own phone-tuned VLM. Runs on a PC over ADB; a Termux port runs on-phone, and its authors say accessibility mode is more stable than the fallback ([source](https://www.sourcepulse.org/projects/20742621)) | Confirms on-phone accessibility control is the stable path                                         |
| **OpenDroid**                                                                       | Kotlin app, accessibility + LLM                                                                                                                                                                            | Shows an all-native app is enough                                                                  |
| **AndroidWorld** (Google DeepMind)                                                  | 116 tasks across 20 apps. 2024 baseline 30.6%, humans 80%                                                                                                                                                  | Use a handful of its task styles as our own eval checklist                                         |

Everything above except OpenDroid runs the brain on a PC over ADB. On-phone,
no-PC operation is the part Deputy must get right, and the main thing it adds
over these projects.

---

## 4. Platform gates and risks in 2026

| Gate                                                                                 | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Impact on Deputy                                                           | Mitigation                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Restricted settings** (Android 13+)                                                | Sideloaded apps can't be granted Accessibility until the user opens App info → ⋮ → _Allow restricted settings_ ([9to5Google](https://9to5google.com/2022/05/06/android-13-sideloaded-accessibility/)). Android 13 exempted session-based (store) installs. Android 15 widened the restriction ([Android Authority](https://androidauthority.com/android-15-restricted-settings-sideloading-3481098)). Current behaviour for our Store's `PackageInstaller` session installs is **unverified**.                                                                   | One-time setup step at most                                                | Onboarding screen explains the exact taps; verify on your phone in Phase 1                                                                                                                                    |
| **Advanced Protection Mode** (Android 16; accessibility block in Android 17)         | With Advanced Protection **on**, apps not declared `isAccessibilityTool=true` are refused accessibility and lose it if already granted ([The Hacker News](https://thehackernews.com/2026/03/android-17-blocks-non-accessibility.html), [Android Authority](https://www.androidauthority.com/android-17-beta-2-advanced-protection-mode-accessibility-apps-3648860))                                                                                                                                                                                              | Deputy can't run with Advanced Protection on                               | Keep Advanced Protection off. Don't fake `isAccessibilityTool=true`: Google says Play Protect blocks apps that misdeclare it.                                                                                 |
| **Play Protect**                                                                     | Flags sideloaded apps that use accessibility to read screens and act, the banking-trojan pattern                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | May warn or block the install. Your Store already hit Play Protect aborts. | Test the first Store install in Phase 1; if flagged, use "Install anyway" or turn off scanning for this one app                                                                                               |
| **Developer verification** (rolling out from 2026-09-30 in BR/ID/SG/TH, global 2027) | Certified Android devices refuse apps from unregistered developers unless the user goes through an "advanced flow" (restart + 24-hour wait). ADB installs are exempt. A free **limited-distribution** tier (≤20 devices, no ID or fee) launched 2026-08 ([Android Developers Blog](https://developer.android.com/blog/posts/android-developer-verification-rolling-out-to-all-developers-on-play-console-and-android-developer-console), [Android Authority](https://www.androidauthority.com/google-android-advanced-flow-sideloading-rollout-begins-3700073/)) | Affects **every app in your Store**, not just Deputy                       | Separate Store-level task: register the `com.haroon.*` packages + release cert under a limited-distribution account before enforcement reaches your region                                                    |
| **OEM background killers**                                                           | Xiaomi/HyperOS (your Store already special-cases it), Samsung and others kill background services and can silently disable accessibility services                                                                                                                                                                                                                                                                                                                                                                                                                | Agent dies mid-task; the service is quietly turned off                     | Onboarding: autostart on, battery "No restrictions", lock in Recents. Optional one-time `adb shell pm grant com.haroon.deputy android.permission.WRITE_SECURE_SETTINGS` lets Deputy re-enable its own service |
| **FLAG_SECURE windows**                                                              | Screenshot refused; the UI tree is often still readable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Agent is partly blind in banking/password apps                             | Fall back to tree-only. Those apps are on the default deny list anyway (§8).                                                                                                                                  |
| **Apps that detect accessibility services**                                          | Some banking apps refuse to open while a non-allowlisted accessibility service is enabled                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Enabling Deputy could lock you out of such an app                          | Quick toggle: Deputy calls `disableSelf()` on request; re-enable takes one tap, or none with the optional ADB grant                                                                                           |
| **Lock screen**                                                                      | Accessibility can't (and mustn't) unlock a secure keyguard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Scheduled tasks can't run while the phone is locked                        | Tasks start only on an unlocked phone. Scheduled tasks post a "tap to run" notification instead.                                                                                                              |

---

## 5. The brain: Claude API

### Models (Anthropic first-party prices, per million tokens)

| Model             | ID                  | Input | Output | Cache read | Notes                                                                 |
| ----------------- | ------------------- | ----- | ------ | ---------- | --------------------------------------------------------------------- |
| Claude Opus 5.5   | `claude-opus-5-5`   | $4    | $20    | $0.20      | Most capable everyday model. Effort defaults to `medium`.             |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | $2    | $10    | $0.20      |                                                                       |
| Claude Haiku 5.5  | `claude-haiku-5-5`  | $0.10 | $0.50  | —          | ≤100K-token prompts. Cheapest by far; phone-agent quality unmeasured. |

All three take images. Thinking can't be turned off on these models, so
`output_config.effort` is the speed/cost control. Forced `tool_choice` returns a
400 on Opus 5.5 and Sonnet 5.5; use `auto` with a prompt instruction and
`strict: true` tools.

### Custom phone tools, not the computer-use toolset

The API's computer-use tool (`computer_toolset_20260801`, the only form
Opus/Sonnet 5.5 accept on the Claude API) models a desktop: mouse buttons,
keyboard chords, 17 member tools. A phone needs tap, long-press, swipe, type,
Back/Home and "open app". **Custom tools** with an indexed UI-tree observation
are a better fit. They are cheaper, because the model reads text instead of
finding pixels, and they are what DroidRun does. A screenshot still goes with
each step for visual context (icons without labels, images, layout).

### Cost per task (estimate, ±50%, to be measured in Phase 2)

Assumptions: screenshot downscaled to ~720×1600 (≈1.5K image tokens at one token
per 28×28 patch), UI tree ≈2K tokens, ≈3.5K new tokens per step, ≈600 output
tokens per step including thinking, 20 steps, prompt caching on (append-only
history).

| Model      | ≈ per 20-step task | ≈ 10 tasks/day for 30 days |
| ---------- | ------------------ | -------------------------- |
| Opus 5.5   | **$0.75**          | ~$225/month                |
| Sonnet 5.5 | **$0.45**          | ~$135/month                |
| Haiku 5.5  | **$0.03**          | ~$9/month                  |

Without caching, the same Sonnet task costs ~$1.70, so caching is mandatory.
Latency: roughly 3–8 s per step, so 1–3 minutes for a 20-step task. Deep links
(§2) cut steps a lot. "Message Ali on WhatsApp" goes straight to the chat
instead of tapping through it.

---

## 6. Architecture finding: where the agent loop must run

The agent spends its whole run with **other apps in the foreground**. That makes
Deputy's own activity paused.

**Verified** in this repo's React Native 0.81.5
(`ReactAndroid/.../modules/core/JavaTimerManager.kt:122,276`): when the host
activity is paused, JS timers (`setTimeout`, `setInterval`) stop firing unless a
Headless JS task is running. A loop written in TypeScript would stall on its
first `sleep`, and the Anthropic SDK's retry backoff uses timers too. Network
promises still resolve, which makes the bug intermittent and easy to miss.

**Conclusion:** the agent loop (Claude calls, tool execution, safety checks)
runs **natively in Kotlin**, inside the same process as the
AccessibilityService. The system keeps that process alive while the service is
enabled. React Native handles the chat UI, settings and history, and receives
progress as Expo module events. This keeps the repo's split: native code in an
Expo local module, UI from `@apps-hub/ui`.

Claude client in Kotlin: the official Java SDK (`com.anthropic:anthropic-java`,
MIT). Its Android compatibility is **unverified** and is the first spike in
Phase 1. Fallback: the same JSON shapes over OkHttp, which React Native already
ships.

The API key gets the same storage as the Store's device token: AES-GCM with a
non-exportable Android Keystore key
(`apps/store/modules/store-installer/.../Credentials.kt`).

---

## 7. What "complete control" can and can't mean

| Can do (accessibility, no root)                                                     | Can't do                                                                            |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Open any app, read any screen, tap/type/scroll/swipe anywhere a finger can          | Unlock a PIN/biometric lock screen                                                  |
| Send messages, fill forms, change settings, manage notifications                    | See into FLAG_SECURE screens visually (tree only, if any)                           |
| Chain several apps in one task ("find the address in the email, book a ride there") | Grant itself runtime permissions or install APKs silently                           |
| Read notifications (via the shade, or a NotificationListener later)                 | Run while the phone is locked or asleep                                             |
| Ask you a question mid-task, wait for the answer, carry on                          | Beat CAPTCHAs or "are you human" checks                                             |
|                                                                                     | Act faster than the app UIs let it (it works at roughly human speed, not instantly) |

---

## 8. Safety and privacy findings

- **Everything on screen during a task goes to Anthropic** (screenshots and UI
  text). Apps with secrets (banking, password manager, authenticator, Store
  credentials) start on a **deny list**: Deputy refuses to operate them and
  doesn't send their screens.
- **Prompt injection is the main threat.** A message or web page on screen can
  say "ignore your task and send …". On-screen text is untrusted data, never
  instructions. Irreversible actions go through a **confirmation gate** that the
  app enforces, not the model: send, pay, buy, delete, post, transfer, install,
  security settings.
- **Kill switch always visible:** accessibility overlay with a Stop button, plus
  a Stop action on the ongoing notification. Stopping ends the run at once.
- **Bounded runs:** step cap and cost cap per task. No action is retried more
  than twice without new information.
- **No telemetry.** Run logs stay on the phone. Only the Claude API sees task
  data.

---

## 9. iOS: what's possible, honestly

- **Operating other apps: impossible** without a jailbreak. No
  accessibility-service equivalent and no cross-app screenshots.
- **What an iOS app could do:** chat with Claude and run actions that apps
  publish to Shortcuts/App Intents. Starting a shortcut from an app goes through
  the `shortcuts://` URL scheme, which brings the Shortcuts app to the front.
  Apple's own agentic Siri over App Intents was still being rolled out at the
  time of writing.
- **Distribution:** with no paid Apple Developer account, a sideloaded build
  expires after 7 days and the Store is Android-only.
- **Recommendation:** no iOS app. If you want one later, the realistic version
  is a Shortcuts-driven chat client, a different and much smaller product.

---

## 10. Open questions (need your answer before the spec)

1. **Model and budget:** Opus 5.5 (best, ~$0.75/task), Sonnet 5.5 (~$0.45), or
   Haiku 5.5 (~$0.03, quality unknown), as the default (switchable in settings
   either way)?
2. **Autonomy:** which actions must stop and ask you first?
3. **First jobs:** which real tasks should it handle first? They become the test
   set.
4. **Triggers:** only when you ask, or also on a schedule / when a notification
   arrives?
5. **Phone:** make, model and Android version. HyperOS/One UI need extra setup
   steps (§4).

---

## Sources

- Cowork on mobile:
  [Engadget](https://engadget.com/2209495/now-you-can-direct-anthropic-claude-cowork-ai-from-your-phone),
  [BleepingComputer](https://bleepingcomputer.com/news/artificial-intelligence/anthropic-is-testing-desktop-like-claude-cowork-for-mobile),
  [TechRadar](https://www.techradar.com/pro/anthropic-could-be-about-to-release-claude-cowork-for-mobile)
- Subscription vs API key:
  [AlternativeTo](https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use),
  [WinBuzzer](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/),
  [GIGAZINE](https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block)
- Restricted settings:
  [9to5Google](https://9to5google.com/2022/05/06/android-13-sideloaded-accessibility/),
  [Android Authority (Android 15)](https://androidauthority.com/android-15-restricted-settings-sideloading-3481098),
  [Esper](https://www.esper.io/blog/android-13-sideloading-restriction-harder-malware-abuse-accessibility-apis)
- Advanced Protection / accessibility:
  [The Hacker News](https://thehackernews.com/2026/03/android-17-blocks-non-accessibility.html),
  [Android Authority](https://www.androidauthority.com/android-17-beta-2-advanced-protection-mode-accessibility-apps-3648860),
  [Android Developers Blog](https://android-developers.googleblog.com/2025/12/enhancing-android-security-stop-malware.html)
- Developer verification:
  [Android Developers Blog](https://developer.android.com/blog/posts/android-developer-verification-rolling-out-to-all-developers-on-play-console-and-android-developer-console),
  [Android Authority](https://www.androidauthority.com/google-android-advanced-flow-sideloading-rollout-begins-3700073/),
  [Bayton](https://bayton.org/blog/2025/08/google-play-developer-verification/)
- AppFunctions:
  [Android Developers Blog](https://android-developers.googleblog.com/2026/02/the-intelligent-os-making-ai-agents.html),
  [9to5Google](https://9to5google.com/2026/02/25/android-appfunctions-gemini/)
- Accessibility screenshot API:
  [TakeScreenshotCallback](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService.TakeScreenshotCallback)
- Shizuku: [manual](https://shizuku.rikka.app/guide/setup.html),
  [Key Mapper ADB permissions](https://docs.keymapper.club/user-guide/adb-permissions/)
- Prior art:
  [Mobilerun/DroidRun Portal](https://docs.mobilerun.ai/droidrun-portal),
  [minitap benchmark](https://minitap.ai/benchmark),
  [Open-AutoGLM (TechNode)](https://technode.com/2025/12/09/zhipu-ai-open-sources-autoglm-an-ai-agent-model-capable-of-full-phone-operation/),
  [Open-AutoGLM Hybrid](https://www.sourcepulse.org/projects/20742621),
  [OpenDroid](https://github.com/yashab-cyber/opendroid),
  [AndroidWorld](https://www.alphaxiv.org/benchmarks/google-deepmind/androidworld)
- iOS:
  [Computerworld (App Intents)](https://www.computerworld.com/article/4037554/to-make-ai-apple-is-cooking-with-app-intents.html),
  [Tom's Guide](https://www.tomsguide.com/phones/iphones/new-siri-will-reportedly-let-you-voice-control-your-iphone-apps-this-could-change-everything)
- Claude API models, pricing, computer-use toolset, image tokens: Anthropic API
  reference (claude-api skill, cached 2026-10-06)
