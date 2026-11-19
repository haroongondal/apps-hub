# Sieve Phase 2 Implementation Plan: YouTube enhancements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** written 2026-11-08. Approved as amended by the owner's answers of 2026-11-10 (see Questions for the owner). Where an answer differs from the text, the answer wins, and the text has been changed to match.

**Goal:** Everything Enhancer for YouTube does that the design keeps (design goal 2), as Sieve's own code: the button row under the player, speed, quality, volume and the booster, the player tools, autoplay rules, page tidying, the theme and the owner's CSS, the experiments manager, keyboard shortcuts, the menu's YouTube tab, and backup and import of the whole extension's settings. The row's Download button is phase 5.

**Architecture:** YouTube settings live in their own `chrome.storage.local` key, `youtube`, validated by `validateYouTube` in `packages/sieve-core`. Task 1.11's two content scripts, `yt-relay.ts` (isolated world) and `yt-main.ts` (main world), become the entry points for every YouTube feature. Both run at `document_start` in every YouTube frame. The isolated script reads the settings and sets attributes and `<style>` elements on `<html>`. It builds the button row, handles the menu and the shortcuts, and sends the main world the part of the settings that needs YouTube's player API. The main script installs its page hooks synchronously (codec checks, experiment flags) and drives the player. Each feature is one module per world under `apps/sieve/src/yt/`, imported by the entry. Pure logic is in `sieve-core` with `node:test` unit tests. Content scripts never write storage: they ask the worker, which writes under the shared settings lock (ruling R20).

**Tech Stack:** no new dependencies. TypeScript (erasable), esbuild 0.28.2, `@types/chrome` 0.3.7, `node --test`, playwright-core and Chrome for Testing for e2e. The e2e test clip is a WAV file the harness generates. ffmpeg is not installed on this Mac (checked 2026-11-08).

**Spec:** `docs/superpowers/specs/2026-11-06-sieve-design.md`: goal 2, "On YouTube: a button row under the player", the menu's YouTube tab, the settings page, "YouTube enhancements" under How it works, and anti-goals 1, 2 and 4. Phase 1 plan: `docs/superpowers/plans/2026-11-06-sieve.md`. Progress: `docs/handoffs/sieve.md`.

**Before starting:** Phase 1 must be committed and reviewed. This plan builds on Task 1.11 as committed in `27a1146`:
- `yt-main.ts` keeps saved copies of `Reflect.apply`, `EventTarget.prototype.dispatchEvent` and `CustomEvent` from before any page script runs.
- `yt-relay.ts` reads `settings` at `document_start`.
- The two worlds talk through `CustomEvent`s on `document` with a plain-object `detail` (`sieve-yt-channel`, `sieve-yt-allow`).
- The manifest has both scripts on `www.youtube.com`, `m.youtube.com`, `music.youtube.com` and `www.youtube-nocookie.com`, with `all_frames: true`.
- The harness serves `test/pages/yt-watch.html` for `/watch?…`, and `launch({ mapHosts: false })` reaches the real youtube.com.
- `test/yt-live.mjs` runs through `pnpm --filter sieve test:e2e -- --live`.

If a later commit changes any of these, keep the committed behaviour and adapt this plan's detail to it.

## Global Constraints

- Chrome only, Manifest V3, `"minimum_chrome_version": "128"` (ruling R15), loaded unpacked from `apps/sieve/dist/`. Never published.
- Erasable TypeScript only (no enums, namespaces or parameter properties; `as const` is fine). Import with the `.ts` extension. List every new `*.test.ts` in its package's `test` script: `packages/sieve-core/package.json` or `apps/sieve/package.json`.
- Content scripts and pages import core modules by file path (`@apps-hub/sieve-core/src/youtube-settings.ts`), as `popup.ts` does, never from the package index: the index pulls in the filter compiler.
- UI uses `packages/ui/web/tokens.css` and `base.css` with `data-brand="sieve"`, the `--c-*` variables and the `.ui-*` classes. No hand-rolled colours or fonts in Sieve's own UI. The button row and its popovers live in an open shadow root that adopts the tokens the way `picker.ts` does, with the system font standing in. The row's `data-theme` follows YouTube's dark theme, not the system's. One exception: the accent palette (Task 2.1) is page content Sieve applies to YouTube. It is data in core, not Sieve UI.
- Copy is sentence case and active voice, with no emoji icons and no ALL-CAPS. Errors say what happened and how to fix it. Every visible string in this plan is exact.
- Privacy: no telemetry and no remote calls of our own. The settings sent to the main world are visible to YouTube's own scripts. Send only what the main world needs (`MainSettings`, Task 2.3), and say so in the README.
- No code is copied from Enhancer. Its settings list was read in recon for feature names only.
- Automated tests never use the owner's Chrome profile. Live tests run signed out in a fresh profile, against `dQw4w9WgXcQ`: YouTube bot-checks `aqz-KE-bpKQ` from this address (handoff, Task 0.4). Keep live runs light: one browser, a few navigations. A bot-check or consent page means SKIP with the reason, as `yt-live.mjs` does. Signed-in checks are an owner checklist (Task 2.19).
- YouTube facts are never written from memory. Every selector, attribute, event name and player-API behaviour this plan uses (other than `#movie_player`, `#movie_player video`, `ytcfg.get`, `ytInitialPlayerResponse` and `#movie_player.ad-showing`, which the spike and Task 1.11 already used) is found by an explicit inspection step: signed out, in the test Chromium, without the extension unless the step says otherwise, using Playwright's `page.addInitScript` for main-world probes. Record each value in code with a comment `// inspected <date>, signed out, Chrome for Testing <version>`.
- Settings writes: the `youtube` key joins `settings`, `myRules`, `myRuleSources` and `myCosmetic` under `withSettingsLock` (`lock.ts`, ruling R20). Content scripts never call `chrome.storage.local.set`. A content script's Web Lock belongs to youtube.com, not to the extension, so content scripts send `{ type: 'yt-set', patch }` to the worker (Task 2.3).
- Phase 2 adds no `declarativeNetRequest` rules and no registered content scripts. `applyBlocking` removes anything not in `blockingPlan`. The worker must still start fast (ruling R5): nothing new parses large data at worker start.
- Page events are untrusted. Every `CustomEvent` `detail` is validated by a core reader before use. The isolated world never writes storage, downloads, or opens a tab because of a page event. Every row and popover handler acts only on `event.isTrusted`. The main world reads browser functions through copies saved at script start, as `yt-main.ts` does.
- Each feature starts inside `feature(name, init)` (Task 2.3), which catches and logs once. A selector that finds nothing turns off that feature only, on that page.
- Cheap on watch pages (anti-goal 1). No `MutationObserver` with `subtree: true` on `document`, `<html>` or `<body>`: observers watch one element's children or attributes, and disconnect on navigation. Listeners on long-lived elements (the video, the player) are added once per element, guarded by a `WeakSet`. Nothing polls without a time limit.
- Defaults: every YouTube option starts at YouTube's own behaviour, so installing phase 2 changes nothing until the owner turns an option on. The button row is the one visible change.
- Parallel work (ruling R22): claim each shared file through coord in alphabetical path order, and hold the claims until a pathspec commit (`git commit -m "…" -- <paths>`). Claim `apps/sieve` around build, e2e and perf runs. During development, run only your own e2e modules with `node apps/sieve/test/yt-e2e.mjs --only <names>`. Run the whole set before committing.
- Commits go on branch `sieve` only, with no Co-Authored-By or "Generated with" lines.
- The four anti-goals are acceptance criteria: browsing does not slow down; sites do not break; downloads are never lost; YouTube does not feel janky.

## Review Focus

1. **Flicker across in-app navigations.**
   - Expect: between watch pages, the row is the same element, inserted once (`data-mounts="1"`), never removed, and never 0 px tall in any animation frame.
   - Expect: the speed value shows the new video's speed within one frame of the player reporting it.
   - Pinned in Task 2.4 (local and live) and Task 2.19 (live gate).
2. **The row re-attaching.**
   - Expect: when YouTube re-renders the area under the player, the row is back within 100 ms. It is the same element with the same shadow root, and its button states are kept.
   - Expect: watch to home to watch reuses the element.
   - Pinned in Task 2.4.
3. **Settings applied at `document_start`.**
   - Expect: the `sieve-yt-applied` mark comes before `first-paint` on a hard load.
   - Expect: a hidden element (a Shorts shelf, comments) is never painted visible, and the dark theme is on in the first frame.
   - Expect: the first video of a hard load starts at the default speed and quality.
   - Pinned in Tasks 2.3 (live), 2.5, 2.12 and 2.13.
4. **Main-world exposure.**
   - Expect: a page that forges `sieve-yt-*` events, or calls `click()` on the row's buttons, cannot make Sieve write storage, download a file or open a tab.
   - Expect: Sieve adds no globals to the page.
   - Expect: the settings the page can see are only `MainSettings`.
   - Pinned in Tasks 2.3, 2.4 and 2.9.
5. **YouTube markup drift.**
   - Expect: a missing selector or player method turns off only that feature, with no page errors.
   - Expect: the live smoke test names the missing selector.
   - Pinned in Task 2.2 (the live selector check), each task's live check, and Task 2.4's `noanchor` fixture.
6. **Premium, members-only and age-restricted pages.** The watch page may have no playable video.
   - Expect: no page errors from Sieve, row actions do nothing, and the menu says so.
   - Pinned in Task 2.4 (`state=unplayable` fixture) and the owner checklist (Task 2.19).
7. **The volume booster and Chrome's autoplay rules.**
   - Expect: no `AudioContext` before the page has had a click or key press, so an autoplaying video is never silenced.
   - Expect: the source node is made only once the context is `running`, with one per video element.
   - Expect: a video whose source is not a `blob:` URL is not routed.
   - Pinned in Task 2.6.
8. **Memory leaks across navigations.**
   - Expect: after 25 in-app navigations, event listeners and DOM nodes on the fixture are flat (nav 25 minus nav 5 is at most 5 listeners and 20 nodes), and the heap grows by at most 1 MB after a forced garbage collection.
   - Pinned in Task 2.19.
9. **Performance on watch pages.**
   - Expect: median watch-page load with Sieve is at most 1.10× without it, with defaults and with every option on, and the heap grows by at most 5 MB.
   - Expect: the relay's settings read costs at most 20 ms more with 2 MB of My filters stored.
   - Pinned in Task 2.19.
10. **Lost or noisy settings writes.**
    - Expect: two writers (a row button and the settings page) never lose each other's change.
    - Expect: dragging a filter slider writes storage at most twice.
    - Pinned in Tasks 2.3 and 2.10.

---

## Shape of the code

Storage (`chrome.storage.local`): `settings` (phase 1, unchanged), `youtube` (`YouTubeSettings`, new), and phase 1's `myRules`, `myRuleSources` and `myCosmetic`. Session storage: `ytPlayers` (Task 2.11).

| World | Entry (already bundled by `build.mjs`) | Phase 2 modules under `apps/sieve/src/yt/` |
|---|---|---|
| Main, `document_start`, every YouTube frame | `yt-main.ts` | `bridge-main.ts`, `codecs-main.ts`, `experiments-main.ts`, `speed-main.ts`, `volume-main.ts`, `quality-main.ts`, `playlist-main.ts` |
| Isolated, `document_start`, every YouTube frame | `yt-relay.ts` | `selectors.ts`, `bridge.ts`, `actions.ts`, `row.ts`, `speed.ts`, `boost.ts`, `wheel.ts`, `loop.ts`, `capture.ts`, `visual.ts`, `autoplay.ts`, `tidy.ts`, `theme.ts` |
| Worker | `background.ts` | `src/yt-handler.ts`, `src/commands.ts` |
| Pages | `popup.ts`, `options.ts` | `src/popup-youtube.ts`, `src/options-youtube.ts`, `src/options-shortcuts.ts`, `src/options-backup.ts` |

Phase 2 features act only where `ytPage(url).kind` (Task 2.3) is not `'other'`: `www.youtube.com` and YouTube embeds. `m.youtube.com` and `music.youtube.com` keep Task 1.11's ad removal and nothing else.

Page events (`CustomEvent` on `document`, plain-object `detail`, validated on receipt):

| Event | Direction | Detail | Reader |
|---|---|---|---|
| `sieve-yt-hello` | main → isolated | none | the relay sends the settings again |
| `sieve-yt-settings` | isolated → main | `MainSettings` | `readMainSettings` |
| `sieve-yt-do` | isolated → main | `{ action, value? }` | `readMainCommand` |
| `sieve-yt-state` | main → isolated | `MainState` | `readMainState` |

Runtime messages:

| Message | From → to | Task |
|---|---|---|
| `{ type: 'yt-set', patch }` → `{ ok, message? }` | content → worker | 2.3 |
| `{ type: 'open-settings', section: 'youtube' }` | content → worker | 2.3 |
| `{ type: 'yt-command', action, value? }` | worker → content (shortcuts) | 2.3 |
| `{ type: 'yt-screenshot', dataUrl, title, seconds }` → `{ ok, message? }` | content → worker | 2.9 |
| `{ type: 'yt-playing', token }` | content → worker | 2.11 |
| `{ type: 'yt-pause', except }` | worker → content | 2.11 |
| port `yt-menu` | menu ↔ top frame content | 2.17 |

Actions: every row button, shortcut and menu control runs an action by id (`YT_ACTIONS`, Task 2.1) through `runAction` (Task 2.3). An id with no isolated-world handler is forwarded to the main world.

---

### Task 2.1: YouTube settings, actions and the settings field list (core)

**Files:**
- Create: `packages/sieve-core/src/youtube-settings.ts`, `src/yt-actions.ts`, `src/__tests__/youtube-settings.test.ts`, `src/__tests__/yt-actions.test.ts`
- Modify: `packages/sieve-core/src/settings.ts` (export the existing `isRecord` helper instead of copying it), `packages/sieve-core/package.json` (test list)

**Parallel:** independent of Task 2.2. Shares `packages/sieve-core/package.json` with every core task.

**Interfaces:**
- Produces, in `youtube-settings.ts`:
  ```ts
  export const YOUTUBE_KEY = 'youtube';
  export const QUALITIES = ['tiny', 'small', 'medium', 'large', 'hd720', 'hd1080', 'hd1440', 'hd2160', 'hd2880', 'highres'] as const;
  export type Quality = (typeof QUALITIES)[number];
  export const QUALITY_HEIGHT: Record<Quality, number>;   // 144, 240, 360, 480, 720, 1080, 1440, 2160, 2880, 4320
  export type QualityChoice = 'auto' | Quality;
  export type FullscreenChoice = 'same' | QualityChoice;
  export type SpeedWheel = 'off' | 'over-speed' | 'right-button';
  export type VolumeWheel = 'off' | 'over-video' | 'right-button';
  export type AutoplayMode = 'allow' | 'background' | 'always';
  export const ACCENTS: readonly { key: string; label: string; hex: string | null }[];
  export interface VideoFilters { blur: number; brightness: number; contrast: number; grayscale: number; hue: number; invert: number; saturate: number; sepia: number }
  export interface YouTubeSettings {
    version: 1;
    on: boolean;                             // the "YouTube tools" switch; independent of the header "Sieve on" switch (blocking)
    speed: { setDefault: boolean; default: number; step: number; anySpeed: boolean; wheel: SpeedWheel };
    volume: { setDefault: boolean; level: number; boostOn: boolean; boost: number; step: number; wheel: VolumeWheel };
    reverseWheel: boolean;
    quality: { videos: QualityChoice; videosFull: FullscreenChoice; playlists: QualityChoice; playlistsFull: FullscreenChoice; embeds: QualityChoice; embedsFull: FullscreenChoice; h264: boolean; max30fps: boolean };
    player: { autoTheater: boolean; expand: boolean; cinema: boolean; backdrop: string; backdropOpacity: number; filtersOn: boolean; filters: VideoFilters };
    autoplay: { mode: AutoplayMode; playlists: boolean; pauseOthers: boolean };
    tidy: { hideShorts: boolean; convertShorts: boolean; hideRelated: boolean; hideComments: boolean; hideChat: boolean; newestComments: boolean; expandDescription: boolean; hideCards: boolean; perRow: { home: number; channel: number; shorts: number; posts: number } };
    theme: { dark: boolean; accent: string; css: string };
    experiments: { presets: string[]; overrides: string };
  }
  export const DEFAULT_YOUTUBE: YouTubeSettings;
  export function validateYouTube(input: unknown): YouTubeSettings;                      // never throws
  export function mergeYouTube(current: YouTubeSettings, patch: unknown): YouTubeSettings; // deep merge, arrays replaced, `version` ignored, then validate
  export type Field =
    | { path: string; kind: 'switch'; label: string; help?: string }
    | { path: string; kind: 'number'; label: string; min: number; max: number; step: number; unit?: string; help?: string }
    | { path: string; kind: 'select'; label: string; options: readonly { value: string; label: string }[]; help?: string }
    | { path: string; kind: 'color'; label: string; help?: string }
    | { path: string; kind: 'text'; label: string; maxLength: number; help?: string };
  export interface FieldGroup { id: string; title: string; help?: string; fields: readonly Field[] }
  export const YOUTUBE_GROUPS: readonly FieldGroup[];
  export function getPath(obj: unknown, path: string): unknown;
  export function setPath<T>(obj: T, path: string, value: unknown): T;   // returns a copy; the input is unchanged
  ```
- `DEFAULT_YOUTUBE`, exactly:
  ```ts
  {
    version: 1,
    on: true,
    speed: { setDefault: false, default: 1, step: 0.25, anySpeed: true, wheel: 'over-speed' },
    volume: { setDefault: false, level: 50, boostOn: false, boost: 2, step: 5, wheel: 'off' },
    reverseWheel: false,
    quality: { videos: 'auto', videosFull: 'same', playlists: 'auto', playlistsFull: 'same', embeds: 'auto', embedsFull: 'same', h264: false, max30fps: false },
    player: { autoTheater: false, expand: false, cinema: false, backdrop: '#000000', backdropOpacity: 85, filtersOn: false,
              filters: { blur: 0, brightness: 100, contrast: 100, grayscale: 0, hue: 0, invert: 0, saturate: 100, sepia: 0 } },
    autoplay: { mode: 'allow', playlists: true, pauseOthers: false },
    tidy: { hideShorts: false, convertShorts: false, hideRelated: false, hideComments: false, hideChat: false, newestComments: false,
            expandDescription: false, hideCards: false, perRow: { home: 0, channel: 0, shorts: 0, posts: 0 } },
    theme: { dark: false, accent: 'youtube', css: '' },
    experiments: { presets: [], overrides: '' },
  }
  ```
- Validation rules:

  | Path | Rule |
  |---|---|
  | `on` | boolean, else `true` |
  | `speed.default` | finite number, rounded to 2 decimals, clamped to 0.1–16 (Chrome refuses rates outside 0.0625–16) |
  | `speed.step` | 2 decimals, 0.05–1 |
  | `volume.level` | integer, 0–100 |
  | `volume.boost` | 1 decimal, 1.1–10 |
  | `volume.step` | integer, 1–20 |
  | `player.backdrop` | `/^#[0-9a-f]{6}$/i`, stored lowercase |
  | `player.backdropOpacity` | integer, 0–100 |
  | `player.filters` | integers: `blur` 0–20, `brightness` and `contrast` 0–200, `grayscale`, `invert` and `sepia` 0–100, `hue` 0–360, `saturate` 0–300 |
  | `tidy.perRow.*` | integer, 0–10 |
  | `theme.accent` | an `ACCENTS` key |
  | `theme.css` | a string of at most 100,000 characters, else `''` |
  | `experiments.presets` | strings matching `/^[a-z0-9-]{1,40}$/`, deduped, at most the first 20 |
  | `experiments.overrides` | a string of at most 10,000 characters, else `''` |
  | enums, booleans | one of the listed values, else the default |
  | a non-number in a number field | the default |
  | `version` not `1` (and present) | the whole of `DEFAULT_YOUTUBE` |
  | both wheels `'right-button'` | `speed.wheel` becomes `'over-speed'` |

- `ACCENTS`, in order: `youtube` "YouTube red" (`null`: leave YouTube's own), `red` "Red" `#e53935`, `pink` "Pink" `#d81b60`, `purple` "Purple" `#8e24aa`, `indigo` "Indigo" `#3949ab`, `blue` "Blue" `#1e88e5`, `cyan` "Cyan" `#00acc1`, `teal` "Teal" `#00897b`, `green` "Green" `#43a047`, `lime` "Lime" `#c0ca33`, `yellow` "Yellow" `#fdd835`, `orange` "Orange" `#fb8c00`, `grey` "Grey" `#757575`.
- `YOUTUBE_GROUPS`, exactly. Quality options: `auto` "Auto", `tiny` "144p", `small` "240p", `medium` "360p", `large` "480p", `hd720` "720p", `hd1080` "1080p", `hd1440` "1440p", `hd2160` "2160p (4K)", `hd2880` "2880p (5K)", `highres` "4320p (8K)". The full-screen options are `same` "Same as outside full screen", then the quality options.

  | Group id, title (help) | Path | Kind and range | Label (help) |
  |---|---|---|---|
  | `tools`, "YouTube tools" | `on` | switch | "YouTube tools" ("Turns the button row and every YouTube feature on or off. Blocking has its own switch.") |
  | `speed`, "Speed" | `speed.setDefault` | switch | "Set a default speed" |
  | | `speed.default` | number 0.1–16, step 0.05, unit "×" | "Default speed" ("Each new video starts at this speed.") |
  | | `speed.anySpeed` | switch | "Allow any speed" ("Slower and Faster go past YouTube's own speeds, up to 16×.") |
  | | `speed.step` | number 0.05–1, step 0.05, unit "×" | "Speed step" ("How much Slower and Faster change the speed.") |
  | | `speed.wheel` | select: `off` "Off", `over-speed` "Over the speed under the video", `right-button` "Over the video while holding the right button" | "Change speed with the mouse wheel" |
  | `volume`, "Volume" | `volume.setDefault` | switch | "Set a default volume" |
  | | `volume.level` | number 0–100, step 1, unit "%" | "Default volume" |
  | | `volume.boostOn` | switch | "Boost volume" |
  | | `volume.boost` | number 1.1–10, step 0.1, unit "×" | "Boost" ("High values distort the sound.") |
  | | `volume.wheel` | select: `off` "Off", `over-video` "Over the video", `right-button` "Over the video while holding the right button" | "Change volume with the mouse wheel" |
  | | `volume.step` | number 1–20, step 1, unit "%" | "Volume step" |
  | | `reverseWheel` | switch | "Reverse the wheel" ("Applies to speed and volume.") |
  | `quality`, "Quality" ("If a video doesn't offer the quality you pick, Sieve picks the closest one below it.") | `quality.videos` | select, quality options | "Videos" |
  | | `quality.videosFull` | select, full-screen options | "Videos in full screen" |
  | | `quality.playlists` | select, quality options | "Playlists" |
  | | `quality.playlistsFull` | select, full-screen options | "Playlists in full screen" |
  | | `quality.embeds` | select, quality options | "Videos on other sites" |
  | | `quality.embedsFull` | select, full-screen options | "Videos on other sites in full screen" |
  | | `quality.h264` | switch | "Play H.264 only" ("YouTube offers H.264 up to 1080p, so higher qualities disappear.") |
  | | `quality.max30fps` | switch | "Play at most 30 frames per second" |
  | `player`, "Player" | `player.autoTheater` | switch | "Open videos in theater mode" |
  | | `player.expand` | switch | "Expand the player to fill the window" |
  | | `player.cinema` | switch | "Cinema mode" ("Dims the page around the player. Click the dimmed part to turn it off.") |
  | | `player.backdrop` | color | "Cinema backdrop colour" |
  | | `player.backdropOpacity` | number 0–100, step 1, unit "%" | "Cinema backdrop opacity" |
  | | `player.filtersOn` | switch | "Video filters" |
  | | `player.filters.blur` | number 0–20, step 1, unit "px" | "Blur" |
  | | `player.filters.brightness` | number 0–200, step 1, unit "%" | "Brightness" |
  | | `player.filters.contrast` | number 0–200, step 1, unit "%" | "Contrast" |
  | | `player.filters.grayscale` | number 0–100, step 1, unit "%" | "Grayscale" |
  | | `player.filters.hue` | number 0–360, step 1, unit "°" | "Hue" |
  | | `player.filters.invert` | number 0–100, step 1, unit "%" | "Invert" |
  | | `player.filters.saturate` | number 0–300, step 1, unit "%" | "Saturation" |
  | | `player.filters.sepia` | number 0–100, step 1, unit "%" | "Sepia" |
  | `autoplay`, "Autoplay" | `autoplay.mode` | select: `allow` "Never", `background` "In tabs opened in the background", `always` "In every tab" | "Stop videos starting by themselves" |
  | | `autoplay.playlists` | switch | "Let playlists keep playing" ("With autoplay stopped in every tab, playlists still start.") |
  | | `autoplay.pauseOthers` | switch | "Pause other videos when one starts" ("Covers YouTube tabs, and YouTube videos on other sites once they have played.") |
  | `page`, "Page" ("For videos per row, 0 keeps YouTube's own layout.") | `tidy.hideShorts` | switch | "Hide Shorts" |
  | | `tidy.convertShorts` | switch | "Open Shorts as normal videos" |
  | | `tidy.hideRelated` | switch | "Hide related videos" |
  | | `tidy.hideComments` | switch | "Hide comments" |
  | | `tidy.hideChat` | switch | "Hide live chat" |
  | | `tidy.newestComments` | switch | "Show newest comments first" |
  | | `tidy.expandDescription` | switch | "Expand video descriptions" |
  | | `tidy.hideCards` | switch | "Hide info cards and end screens" |
  | | `tidy.perRow.home` | number 0–10, step 1 | "Videos per row on Home" |
  | | `tidy.perRow.channel` | number 0–10, step 1 | "Videos per row on channel pages" |
  | | `tidy.perRow.shorts` | number 0–10, step 1 | "Shorts per row" |
  | | `tidy.perRow.posts` | number 0–10, step 1 | "Posts per row" |
  | `theme`, "Theme" | `theme.dark` | switch | "Dark theme" |
  | | `theme.accent` | select, from `ACCENTS` (`key`, `label`) | "Accent colour" |
  | | `theme.css` | text, maxLength 100000 | "My CSS" ("Sieve adds this to every YouTube page.") |
  | `experiments`, "Experiments" ("Changing these can break YouTube. Clear them to undo.") | `experiments.overrides` | text, maxLength 10000 | "Flag overrides" ("One per line: name=true, name=false or name=value.") |

  `experiments.presets` has no field: Task 2.16 renders it from `EXPERIMENT_PRESETS` (Task 2.14).
- Produces, in `yt-actions.ts`:
  ```ts
  export const YT_ACTIONS: readonly { id: string; command: string }[];   // `as const`
  export type YtActionId = (typeof YT_ACTIONS)[number]['id'];
  export const ROW_ORDER: readonly string[];   // ['loop','speed-down','speed','speed-up','boost','cinema','expand','filters','flip','screenshot','pip','download','settings']
  export const SETTINGS_COMMAND = 'open-settings';
  export function commandsManifest(): Record<string, { description: string }>;
  export function actionOfCommand(command: string): YtActionId | null;
  ```
  `YT_ACTIONS`, in order (`id`: `command`):
  - `loop`: Loop on or off
  - `stop`: Stop the video
  - `reverse-playlist`: Reverse the playlist on or off
  - `speed-down`: Slower
  - `speed-up`: Faster
  - `speed-default`: Default speed
  - `speed-normal`: Normal speed
  - `boost`: Volume boost on or off
  - `cinema`: Cinema mode on or off
  - `expand`: Expand the player on or off
  - `filters`: Video filters on or off
  - `flip-h`: Flip horizontally
  - `flip-v`: Flip vertically
  - `screenshot`: Take a screenshot
  - `pip`: Picture-in-picture
  - `comments`: Show or hide comments
  - `related`: Show or hide related videos
  - `cards`: Show or hide info cards and end screens
  - `quality-auto`: Quality auto
  - `quality-tiny` to `quality-highres`: Quality 144p, Quality 240p, Quality 360p, Quality 480p, Quality 720p, Quality 1080p, Quality 1440p, Quality 2160p, Quality 2880p, Quality 4320p

  That is 29 actions. `commandsManifest()` maps each to `yt-<id>`, with the description `YouTube: ` followed by the command with its first letter lowercased (for example "YouTube: loop on or off" and "YouTube: quality 1080p"). It adds `open-settings` with the description "Open Sieve settings". That makes 30 commands, none with `suggested_key`.

- [ ] **Step 1: Write the failing `youtube-settings.test.ts`.**
  - `validateYouTube(undefined)`, `validateYouTube('x')` and `validateYouTube({ version: 2 })` each deep-equal `DEFAULT_YOUTUBE`, and `DEFAULT_YOUTUBE` deep-equals the object above.
  - Speed:
    - `{ speed: { default: 99 } }` gives 16.
    - `0` gives 0.1.
    - `1.234` gives 1.23.
    - `'1.5'` and `NaN` give 1.
  - Volume: `{ volume: { level: 50.6 } }` gives 51, `-3` gives 0, `boost: 0.5` gives 1.1, and `boost: 2.25` gives 2.3.
  - Quality:
    - `{ quality: { videos: 'hd9999' } }` gives `'auto'`.
    - `videosFull: 'same'` is kept.
    - `videos: 'same'` gives `'auto'`.
  - Wheels: `{ speed: { wheel: 'right-button' }, volume: { wheel: 'right-button' } }` gives `speed.wheel === 'over-speed'` and `volume.wheel === 'right-button'`.
  - Backdrop: `'#ABCDEF'` gives `'#abcdef'`, and `'red'` and `'#abc'` give `'#000000'`.
  - Filters: `{ player: { filters: { hue: 400, saturate: -1, blur: 2.4 } } }` gives hue 360, saturate 0 and blur 2.
  - Per row: `{ tidy: { perRow: { home: 11 } } }` gives 10, and `3.6` gives 4.
  - Theme: a 100,000-character `theme.css` is kept, and 100,001 characters gives `''`. Accent `'blue'` is kept, and `'nope'` gives `'youtube'`.
  - Experiments:
    - Presets `['modern-player', 'modern-player', 'Bad Id!', 'x'.repeat(41)]` give `['modern-player']`.
    - 21 valid distinct ids keep the first 20.
    - A 10,001-character `overrides` gives `''`.
  - On: `{ on: false }` is kept, and `{ on: 'no' }` gives `true`.
  - Unknown keys: `{ extra: 1, speed: { extra: 2 } }` deep-equals `DEFAULT_YOUTUBE`.
  - `mergeYouTube`:
    - `mergeYouTube(DEFAULT_YOUTUBE, { player: { cinema: true } })` differs from the default only in `player.cinema`.
    - `{ volume: { level: 500 } }` gives 100.
    - The patch `'x'` returns the current settings.
    - `{ version: 9, player: { expand: true } }` gives `player.expand === true`.
    - `presets: ['a']`, then `presets: []`, ends with `[]`.
  - Fields:
    - Every leaf path of `DEFAULT_YOUTUBE` except `version` and `experiments.presets` (so `on` is included) is the `path` of exactly one field, and every field path is such a leaf.
    - For each number field, `validateYouTube(setPath(DEFAULT_YOUTUBE, f.path, f.max + 1000))` reads back `f.max` at `f.path`, and `f.min - 1000` reads back `f.min`.
    - For each select field, every option value round-trips, and `'nope'` does not.
  - Paths: `getPath({ a: { b: 1 } }, 'a.b') === 1`, and `setPath({ a: { b: 1 } }, 'a.b', 2)` deep-equals `{ a: { b: 2 } }` while the input still has `b: 1`.
- [ ] **Step 2: Write the failing `yt-actions.test.ts`.**
  - `commandsManifest()` has 30 keys. Each value's only key is `description`. `commandsManifest()['yt-loop'].description === 'YouTube: loop on or off'`, `['yt-quality-hd1080'].description === 'YouTube: quality 1080p'`, and `['open-settings'].description === 'Open Sieve settings'`.
  - `actionOfCommand('yt-loop') === 'loop'`, while `actionOfCommand('yt-nope')` and `actionOfCommand('open-settings')` are `null`.
  - Action ids are unique. `ROW_ORDER` has 13 unique ids, `'pip'` comes just after `'screenshot'`, and `'download'` comes just before `'settings'`.
- [ ] **Step 3: Run the tests.** Run `node --test packages/sieve-core/src/__tests__/youtube-settings.test.ts packages/sieve-core/src/__tests__/yt-actions.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement both modules, and add both tests to the `test` script.**
- [ ] **Step 5: Run the tests.** Run `pnpm --filter @apps-hub/sieve-core test && pnpm --filter @apps-hub/sieve-core typecheck`. Expected: PASS.
- [ ] **Step 6: Commit.** Commit with the message `Sieve core: YouTube settings, actions and field list`.

### Task 2.2: YouTube page facts, selectors and test fixtures

**Files:**
- Create: `apps/sieve/src/yt/selectors.ts`
- Create: `apps/sieve/test/pages/yt/watch.html`, `home.html`, `embed.html`, `embed-host.html`, `player.js`
- Create: `apps/sieve/test/yt-e2e.mjs`, `test/yt/helpers.mjs`, `test/yt/fixture.mjs`
- Modify: `apps/sieve/test/harness.mjs` (routes), `test/yt-live.mjs` (runs every module's `live`), `apps/sieve/package.json` (script `test:yt`)

**Parallel:** independent of Task 2.1. Shares `harness.mjs`, `yt-live.mjs` and `apps/sieve/package.json` with no other phase 2 task running at the same time.

**Interfaces:**
- Produces, in `selectors.ts`, with each value recorded in Step 1:

  | Export | What it is |
  |---|---|
  | `SEL.player` | `#movie_player` |
  | `SEL.video` | the main video element (`#movie_player video` unless Step 1 finds a more precise one) |
  | `SEL.watch` | the watch page's root element |
  | `SEL.rowAnchor` | the element under the player that the row is inserted before (the first block of the title area) |
  | `SEL.playerBox` | the player container to raise above the cinema backdrop, default layout |
  | `SEL.theaterBox` | the same in theater layout |
  | `SEL.sizeButton` | YouTube's theater (size) button |
  | `SEL.masthead` | the top bar |
  | `THEATER_ATTR` | the attribute on `SEL.watch` that marks theater layout |
  | `DARK_ATTR` | the attribute on `<html>` that marks YouTube's dark theme |
  | `NAV` | `{ start, finish, data, target }`: the navigation event names (`data` is `null` if there is none) and whether they fire on `document` or `window` |
  | `PLAYER_API` | the player methods phase 2 calls that Step 1 found on `#movie_player` |

- Produces, in `test/yt/helpers.mjs` (e2e):
  ```js
  export const FIXTURE_IDS = ['sieveTest01', 'sieveTest02', 'sieveTest03', 'sieveTest04', 'sieveTest05'];
  export function ytUrl(t, path, fixture = 'watch')   // https://www.youtube.com:PORT<path> plus `fixture=<name>`
  export async function openYt(t, path, fixture)      // a new page; its page errors go into t.errors
  export async function setYouTube(t, patch)          // mergeYouTube (imported from core in Node) then chrome.storage.local.set through t.sw
  export async function setSettings(t, patch)         // the same for `settings`, through validateSettings
  export function row(page)                           // locator 'sieve-yt-row'
  export function rowButton(page, name)               // row(page).getByRole('button', { name })
  export async function navigate(page, id, query)     // calls the fixture's __navigate and waits for NAV.finish
  export async function ytCalls(page, name)           // the fixture's recorded player-API calls, optionally one method
  export async function until(fn, ms = 5000)          // polls every 50 ms
  export async function latestDownload(t)             // chrome.downloads.search, newest first
  ```
- Produces the module contract for `test/yt/*.mjs` (every file except `helpers.mjs`):
  ```js
  export async function local(t)   // t = { ctx, sw, id, servers, check, errors, shots, base }; base is https://www.youtube.com:PORT
  export async function live(t)    // t = { ctx, sw, id, check, page, videoId: 'dQw4w9WgXcQ', shots }; page is the signed-out watch page
  ```
  `yt-e2e.mjs` runs each module's `local` in name order, in one browser launched with `launch({ extraHosts: ['www.youtube-nocookie.com'], extraArgs: ['--autoplay-policy=no-user-gesture-required'] })`.
  - `--only a,b` runs only those modules (`fixture` always runs).
  - A module that throws is one FAIL with its message.
  - The run exits 1 on any failure.
- Produces the fixture page API (`player.js`, loaded by every fixture page):
  - `#movie_player` with fakes of exactly the `PLAYER_API` methods: same names, argument shapes and return shapes as Step 1 records. They are backed by the real `<video>`, and every call is recorded in `window.__ytCalls` as `{ name, args }`.
  - `window.__navigate(id, { list, index } = {})` copies YouTube's in-app navigation as Step 1 records it. It fires `NAV.start` on `NAV.target`, calls `history.pushState`, swaps the same video element's `src` and the title, then fires `NAV.finish` (and `NAV.data` if it exists). `__navigate('home')` shows the home grid inside the same document.
  - `window.__rerenderBelow()` replaces every child of the row anchor's parent with fresh copies, as a YouTube re-render does.
  - The video autoplays on load and after each navigation, unless `autoplay=0`.
  - The video's `src` is a `blob:` URL made from `/media/tone.wav`, as YouTube's is a `blob:` URL. With `src=direct` it is `/media/tone.wav` itself.
  - Variants:
    - `state=unplayable`: no source, and the player reports an error state.
    - `list=PLsieve&index=<n>`: a playlist of `FIXTURE_IDS`.
    - `noanchor=1`: no row anchor.
    - `canvas=1`: the video plays a 320×180 `canvas.captureStream()` filled with `#3366cc`.
  - `window.__keys` and `window.__ctx` record `keydown` and `contextmenu` events that reach `document`.
- Produces harness routes: on `www.youtube.com` and `www.youtube-nocookie.com`, a request whose query has `fixture=<name>` (name `^[a-z0-9-]+$`) serves `test/pages/yt/<name>.html`, with `%PORT%` replaced. `/yt/<file>.js` serves `test/pages/yt/<file>.js`. `/media/tone.wav` serves a generated 5 s, 440 Hz, mono, 16-bit, 8 kHz WAV (80,044 bytes) with `Accept-Ranges: bytes` and `206` range replies. `/watch?…` without `fixture` keeps Task 1.11's `yt-watch.html`.
- Produces `apps/sieve/package.json` script `"test:yt": "node test/yt-e2e.mjs"`. `test:e2e` stays as it is, so `pnpm --filter sieve test:e2e -- --live` still reaches `yt-live.mjs`.

- [ ] **Step 1: Inspect the signed-out pages and record the facts.**
  - Setup: launch Chrome for Testing directly with playwright-core (the same `PLAYWRIGHT_CORE` and `CHROMIUM_PATH` defaults as `harness.mjs`), in a fresh temporary profile and without the extension. Use `dQw4w9WgXcQ`, a public playlist found from a search results page (record its id for the live checks), and a channel's Videos page. Record every answer in `selectors.ts` with the inspection comment.
  - a. Navigation: confirm the names of YouTube's navigation-start, navigation-finish and page-data events (the design names `yt-navigate-finish`). Record which target they are dispatched on, whether the finish event also fires on the first load, and whether `location.href` is already the new address when it fires.
  - b. The link a test clicks for an in-app navigation (a related video). Confirm it with `performance.getEntriesByType('navigation').length` staying 1.
  - c. Every function name on `#movie_player`. For each of these candidates, record whether it exists and what it returns or does: `getPlayerState`, `getVideoData`, `getPlaybackRate`, `setPlaybackRate`, `getAvailablePlaybackRates`, `getAvailableQualityLevels`, `getPlaybackQuality`, `setPlaybackQuality`, `setPlaybackQualityRange`, `getVolume`, `setVolume`, `isMuted`, `mute`, `unMute`, `getPlaylist`, `getPlaylistIndex`, `playVideoAt`, `nextVideo`, `stopVideo`, `pauseVideo`, `playVideo`, `seekTo`, `addEventListener`. Also record the event names `addEventListener` accepts for state, rate and quality changes. The candidates found go in `PLAYER_API`.
  - d. The video element:
    - its precise selector
    - its `src` scheme
    - `disablePictureInPicture`
    - whether it is the same element after an in-app navigation
    - whether YouTube's own context-menu Loop sets `video.loop`
    - whether `video.pause()` from a script leaves YouTube's play button showing "Play"
  - e. Layout:
    - the row anchor
    - the player containers in default and theater layout
    - the theater attribute
    - the size button
    - the masthead, its height and its `z-index`
    - whether the watch root stays in the document (hidden) after navigating to home
  - f. YouTube's dark theme attribute on `<html>`, and whether YouTube removes it at startup on a light profile.
- [ ] **Step 2: Write the fixtures and the harness routes.** Build `watch.html` from Step 1's structure: the masthead, the watch root, the player containers, `#movie_player` with the video, the row anchor and its siblings, and a related list of `FIXTURE_IDS` links. Build `home.html` (a grid of three items), `embed.html` (only a player) and `embed-host.html` (`https://localhost:PORT/` page with an iframe of `https://www.youtube-nocookie.com:PORT/embed/sieveTest01?fixture=embed`).
- [ ] **Step 3: Write the runner, the helpers and `fixture.mjs`.**
  - `local` checks:
    - The fixture watch page loads with no page errors, and `#movie_player.getPlayerState` is a function.
    - `__navigate('sieveTest02')` changes `location.search` to contain `v=sieveTest02` and fires `NAV.finish` exactly once.
    - The video plays: `currentTime > 0.5` after 1.5 s.
    - It seeks: after setting `currentTime = 3`, a read within 0.3 s is between 2.9 and 3.3.
    - `src` starts with `blob:`.
  - `live` checks (the markup-drift alarm): on the signed-out watch page, every `SEL` entry except `theaterBox` finds an element, and every `PLAYER_API` name is a function on `#movie_player`. Each failure names the entry.
- [ ] **Step 4: Run them under coord's `apps/sieve` claim.** Run `pnpm --filter sieve build && pnpm --filter sieve test:yt && pnpm --filter sieve test:e2e && pnpm --filter sieve test:e2e -- --live`. Expected: PASS, and Task 1.11's checks still pass.
- [ ] **Step 5: Hand the facts to the controller.** Report each Step 1 fact in the final report (the controller records them in the handoff's "Verified facts").
- [ ] **Step 6: Commit.** Commit with the message `Sieve: YouTube page facts and test fixtures`.

### Task 2.3: Settings at `document_start` and the page bridge

**Files:**
- Create: `packages/sieve-core/src/yt-bridge.ts`, `src/__tests__/yt-bridge.test.ts`
- Create: `apps/sieve/src/yt/bridge.ts` (isolated), `src/yt/bridge-main.ts` (main), `src/yt/actions.ts` (isolated), `src/yt-handler.ts` (worker), `src/__tests__/yt-handler.test.ts`, `apps/sieve/test/yt/bridge.mjs`
- Modify: `apps/sieve/src/yt-relay.ts`, `src/yt-main.ts` (start the bridges; the relay reads `settings` and `youtube` in one `get`), `src/background.ts` (`chrome.runtime.onMessage.addListener(onYouTubeMessage)`), both `package.json` test lists

**Parallel:** after Tasks 2.1 and 2.2. Every later task depends on it.

**Interfaces:**
- Produces (core):
  ```ts
  export type YtPageKind = 'watch' | 'browse' | 'shorts' | 'embed' | 'chat' | 'other';
  export interface YtPage { kind: YtPageKind; videoId: string | null; list: string | null }
  export function ytPage(url: string): YtPage;    // www.youtube.com (any port) and www.youtube-nocookie.com/embed only
  export interface MainSettings { on: boolean /* youtube.on, never settings.enabled */; speed: YouTubeSettings['speed']; volume: { setDefault: boolean; level: number; step: number };
                                  quality: YouTubeSettings['quality']; experiments: YouTubeSettings['experiments'] }
  export function mainSettings(y: YouTubeSettings, on: boolean): MainSettings;
  export function readMainSettings(detail: unknown): MainSettings | null;
  export interface MainState { videoId: string | null; title: string; rate: number; quality: string; qualities: Quality[]; volume: number;
                               muted: boolean; live: boolean; playlist: { index: number; length: number; reversed: boolean } | null }
  export function readMainState(detail: unknown): MainState | null;   // page data is untrusted: clamps and caps
  export interface MainCommand { action: string; value?: number | string }
  export function readMainCommand(detail: unknown): MainCommand | null;
  export const EVENTS: { hello: 'sieve-yt-hello'; settings: 'sieve-yt-settings'; do: 'sieve-yt-do'; state: 'sieve-yt-state' };
  ```
- Produces (isolated, `bridge.ts`):
  ```ts
  export function feature(name: string, init: () => void): void;   // runs init; on a throw logs `Sieve: <name> is off on this page` once
  export function currentPage(): YtPage;
  export function onSettings(cb: (y: YouTubeSettings, on: boolean) => void): void;  // at once if known; then on every change; `on === y.on`
  export function onNavigate(cb: (p: YtPage) => void): void;         // after NAV.finish, and once after the first settings on a hard load
  export function addStyle(css: string): void;                      // attribute-gated static CSS, appended to <html> now
  export function setStyle(id: string, css: string): void;           // settings-driven CSS in its own <style data-sieve="id">
  export function setFlag(name: string, on: boolean): void;          // a token in <html sieve-yt="…">
  export function toMain(cmd: MainCommand): void;
  export function onMainState(cb: (s: MainState) => void): void;
  export function mainState(): MainState | null;
  export function saveYouTube(patch: unknown): Promise<{ ok: boolean; message?: string }>;
  ```
- Produces (isolated, `actions.ts`):
  ```ts
  export function defineAction(id: YtActionId, run: (value?: string) => void | Promise<void>, pressed?: () => boolean): void;
  export async function runAction(id: string, value?: string): Promise<void>;   // no isolated handler: forwarded as toMain({ action: id, value })
  export function actionStates(): Record<string, boolean>;                     // ids with `pressed`
  export function onActionsChanged(cb: () => void): void;
  export function notifyActions(): void;                                       // features call it after a toggle changes
  ```
- Produces (main, `bridge-main.ts`):
  ```ts
  export function feature(name: string, init: () => void): void;
  export function onSettings(cb: (s: MainSettings) => void): void;
  export function onCommand(action: string, cb: (value?: number | string) => void): void;
  export function sendState(patch: Partial<MainState>): void;      // merged into the last state; sent at most every 100 ms
  export function player(): YtPlayer | null;                       // #movie_player with every PLAYER_API function, else null
  export function onVideo(cb: (videoId: string) => void): void;    // each new video: capture-phase `loadstart` on document plus a video-id change
  export interface YtPlayer { /* the PLAYER_API methods, typed from Task 2.2's record */ }
  ```
- Produces (worker, `yt-handler.ts`):
  ```ts
  export function onYouTubeMessage(message: unknown, sender: chrome.runtime.MessageSender, respond: (reply: unknown) => void): boolean;
  // { type: 'yt-set', patch }: withSettingsLock(read youtube, mergeYouTube, write), then respond { ok: true }, or { ok: false, message }
  // { type: 'open-settings', section: 'youtube' }: chrome.tabs.create({ url: chrome.runtime.getURL('options.html#youtube') })
  // Any other type returns false, so pick-handler.ts and the others keep their messages.
  ```
- Behaviour:
  - At `document_start` the relay calls `chrome.storage.local.get(['settings', 'youtube'])` once (Task 1.11's own read joins this one, and still needs `settings`). It computes `y = validateYouTube(youtube)` and `on = y.on`, never `settings.enabled`, runs every `onSettings` callback in the same task, and then calls `performance.mark('sieve-yt-applied')`. If Step 1 finds the mark is not visible to the main world, it sets `<html data-sieve-yt-at="<performance.now()>">` instead. Then it dispatches `sieve-yt-settings` with `mainSettings(y, on)`.
  - The main script dispatches `sieve-yt-hello` when it starts. The relay answers every hello with the settings, so the order the two scripts start in does not matter.
  - The relay follows `storage.onChanged` (local `youtube`) the same way. A change to `settings` does not touch the YouTube tools, so the header "Sieve on" switch (blocking only, phase 1, unchanged) never changes `on`.
  - "YouTube tools" off (`youtube.on` false) calls every callback with `on = false`. Each feature then removes what it added. The header "Sieve on" switch, "Pause everywhere" and the allowlist do not affect YouTube tools.
  - Runtime `{ type: 'yt-command', action, value? }` follows the frame rule. The top frame acts when its page kind is not `'other'`. An embed frame acts only while its video is playing. While `youtube.on` is false, `yt-command` does nothing.

- [ ] **Step 1: Confirm two browser facts in the fixture, and record them in `bridge.ts`.** Are `performance.mark` entries made in the isolated world visible to `performance.getEntriesByName` in the main world? Does headless Chrome for Testing record a `first-paint` entry (else use `first-contentful-paint`)?
- [ ] **Step 2: Write the failing `yt-bridge.test.ts`.**
  - `ytPage` of:
    - `https://www.youtube.com/watch?v=dQw4w9WgXcQ` gives `{ kind: 'watch', videoId: 'dQw4w9WgXcQ', list: null }`.
    - `…&list=PLx` gives `list: 'PLx'`.
    - `/watch?v=bad` gives `kind: 'watch'` with `videoId: null`.
    - `https://www.youtube.com/`, `/@name/videos`, `/results?search_query=x` and `/playlist?list=PLx` give `'browse'`.
    - `/shorts/dQw4w9WgXcQ` gives `'shorts'` with the id.
    - `https://www.youtube.com/embed/dQw4w9WgXcQ` and `https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?list=x` give `'embed'`.
    - `/live_chat?v=x` and `/live_chat_replay?x=1` give `'chat'`.
    - `https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ` gives `'watch'`.
    - `https://m.youtube.com/watch?v=dQw4w9WgXcQ`, `https://music.youtube.com/watch?v=dQw4w9WgXcQ`, `https://example.com/` and `'nonsense'` give `'other'`.
  - Main settings: `readMainSettings(mainSettings(DEFAULT_YOUTUBE, true))` deep-equals its input, `mainSettings(y, y.on).on === y.on`, and `readMainSettings('x')` and `readMainSettings({ on: 'yes' })` are `null`.
  - Main state:
    - `readMainState({ rate: 99, qualities: ['hd1080', 'bogus', 'auto'], title: 'x'.repeat(1000), volume: 150 })` gives rate 16, qualities `['hd1080']`, a 300-character title and volume 100. Missing fields get the defaults `{ videoId: null, title: '', rate: 1, quality: 'auto', qualities: [], volume: 100, muted: false, live: false, playlist: null }`.
    - `readMainState(null)` is `null`.
  - Main commands: `readMainCommand({ action: 'speed-step', value: 1 })` is kept, while `{ action: 7 }` and `{ action: 'x'.repeat(65) }` are `null`.
- [ ] **Step 3: Write the failing `yt-handler.test.ts`** with an in-memory `chrome`, as `my-filters.test.ts` builds one.
  - Two concurrent `yt-set` messages, `{ player: { cinema: true } }` and `{ player: { expand: true } }`, both land.
  - `{ volume: { level: 900 } }` stores 100.
  - A patch of `'x'` leaves storage unchanged and answers `{ ok: true }`.
  - `open-settings` creates a tab with `chrome-extension://sieve/options.html#youtube`.
  - `{ type: 'pick' }` returns `false`.
- [ ] **Step 4: Run, implement, and run again.** Run `pnpm --filter @apps-hub/sieve-core test && pnpm --filter sieve test`. Expected: FAIL, then PASS.
- [ ] **Step 5: Write `test/yt/bridge.mjs`.**
  - **Local, settings delivery:** `fixture=watch` has one `sieve-yt-applied` mark (or the attribute from Step 1). `player.js` records the last `sieve-yt-settings` detail in `window.__lastSieveSettings`.
  - **Local, live update:** after `setYouTube(t, { speed: { default: 1.5 } })`, without a reload, `__lastSieveSettings.speed.default === 1.5` within 1 s. It is still 1.5 after a reload.
  - **Local, YouTube tools off:** with `youtube.on` false, `__lastSieveSettings.on === false`. With `settings.enabled` false and `youtube.on` true, `__lastSieveSettings.on` stays `true`.
  - **Local, commands while off:** no action has a handler yet in this task, so `runAction` forwards every id to the main world as a `sieve-yt-do` event. `player.js` records each `sieve-yt-do` detail in `window.__sieveDo` (an array), as it records `__lastSieveSettings`. With `youtube.on` true, the worker's `yt-command` `speed-default` adds `{ action: 'speed-default' }` to `__sieveDo`. With `youtube.on` false, the same message leaves `__sieveDo` empty.
  - **Local, forged events:**
    - The page dispatches `sieve-yt-state` with a 5,000-character title and `sieve-yt-hello` 100 times: there are no page errors, and `chrome.storage.local.get('youtube')` is unchanged.
    - The page dispatches `sieve-yt-do` with `{ action: 'boost' }`: storage is unchanged.
    - `Object.keys(window)` and `Object.getOwnPropertyNames(window)` add no names compared with the same fixture with `youtube.on` false and `settings.enabled` false.
  - **Local, unknown command:** `chrome.tabs.sendMessage(tabId, { type: 'yt-command', action: 'nope' })` from the worker causes no page error.
  - **Local, embed:** `embed-host.html` with the nocookie embed shows `__lastSieveSettings` set inside the frame.
  - **Live:** on 3 hard loads of the watch page, the mark's `startTime` is less than the first-paint entry's `startTime`. If this fails, stop and report BLOCKED with the timings. Decision 4 is then wrong, and its fallback needs the owner.
- [ ] **Step 6: Run the checks.** Run `pnpm --filter sieve build && pnpm --filter sieve test:yt -- --only bridge && pnpm --filter sieve test:e2e -- --live`. Expected: PASS.
- [ ] **Step 7: Commit.** Commit with the message `Sieve: YouTube settings at document_start and the page bridge`.

### Task 2.4: The button row

**Files:**
- Create: `apps/sieve/src/yt/row.ts`, `src/yt/row.css`, `apps/sieve/test/yt/row.mjs`
- Modify: `apps/sieve/src/yt-relay.ts` (import)

**Parallel:** after Task 2.3. It can run alongside Tasks 2.7, 2.11, 2.12, 2.13, 2.14 and 2.18, which use no row. Shares `yt-relay.ts`.

**Interfaces:**
- Produces:
  ```ts
  export interface RowButton {
    id: string;                              // a ROW_ORDER id; buttons render in ROW_ORDER order
    label: string | (() => string);
    title?: string;                          // tooltip and aria-description
    ariaLabel?: string | (() => string);     // when the visible label is a symbol
    icon?: () => SVGElement;                 // an inline SVG shown instead of the visible text; `label` stays required and becomes the tooltip, and `ariaLabel` names the button
    pressed?: () => boolean;                 // makes it a toggle (aria-pressed)
    onClick: () => void;                     // trusted clicks only
    menu?: { label: string; build: () => HTMLElement };   // adds a narrow arrow part that opens this popover; label is its aria-label
  }
  export function addButton(b: RowButton): void;
  export function addMenuItem(item: { id: string; label: string; onClick: () => void; visible?: () => boolean; checked?: () => boolean }): void;
  export function refreshRow(): void;        // also runs on notifyActions()
  export function toast(text: string): void; // role=status line in the row; cleared after 2 s
  export function rowElement(id: string): HTMLElement | null;
  ```
- The shell:
  - A host element `<sieve-yt-row>` with an open shadow root that adopts the UI tokens as `picker.ts` does. Inside is a wrapper with `data-brand="sieve"`, and `data-theme` set to `dark` or `light` from `DARK_ATTR` on `<html>`. An attribute observer on `<html>` only (`attributeFilter: [DARK_ATTR]`) keeps it current.
  - The cog is always last. Its aria-label is "More and settings", and it shows an inline SVG cog, not an emoji. It opens a menu with the registered items (Stop, and Reverse playlist only with a playlist, both from Task 2.8), then "Sieve settings", which sends `{ type: 'open-settings', section: 'youtube' }`.
  - Picture-in-picture is a row button, not a cog item. It sits just after Screenshot (`ROW_ORDER`, 13 ids). Task 2.9 registers it with the aria-label "Picture-in-picture", a pressed state while PiP is open, and an inline SVG icon (`icon`), no emoji.
- Mounting:
  - Only in the top frame, on `kind === 'watch'`, while the YouTube tools are on (`youtube.on`).
  - `ensureMounted()` runs on the first settings, on every `onNavigate`, and from an observer on the anchor's parent (`childList` only). It inserts the host before `SEL.rowAnchor` when it is not already there, and adds 1 to `data-mounts` on each insertion.
  - It never removes the host on navigation. When the YouTube tools are turned off, the host is `hidden`.
  - If the anchor is missing, it retries every 100 ms for up to 10 s. The next navigation cancels the retries.
- Input:
  - Every key event from inside the shadow root stops at the row (`stopPropagation`), so YouTube's own shortcuts never fire while the row has focus.
  - One popover is open at a time. It opens below its button and moves focus into itself. Esc, a click outside (a `pointerdown` listener on `document`, added only while open) or a second click closes it, and focus returns to its button.
  - Every handler ignores events that are not `isTrusted`.

- [ ] **Step 1: Write `test/yt/row.mjs` (failing).**
  - **Local, appearance:** the row appears before the anchor within 2 s, with one button named "More and settings".
  - **Local, no flicker:** before 5 `navigate` calls the test stores `window.__row`. After each call:
    - `window.__row === document.querySelector('sieve-yt-row')`
    - `data-mounts === '1'`
    - a test `MutationObserver` on the anchor's parent saw 0 removals of the host
    - the host's height, sampled in every animation frame during the navigation, never hit 0
  - **Local, re-render:** `__rerenderBelow()` puts the row back within 100 ms, with `data-mounts === '2'` and the same `window.__row`.
  - **Local, tools off:** with `youtube.on` false on a hard load there is no row host. Turning it on mounts one. Turning it off again sets `hidden` on that same host, and turning it on again removes `hidden` from the same element.
  - **Local, icon button:** a test-registered button with `icon` renders an SVG, has no text label and keeps its aria-label.
  - **Local, watch to home and back:** `navigate(page, 'home')` then a watch id shows the row again as the same element.
  - **Local, missing anchor or video:** `noanchor=1` gives no row and no page errors. `state=unplayable` gives a row and no page errors.
  - **Local, page clicks:** a page script calls `document.querySelector('sieve-yt-row').shadowRoot.querySelector('button').click()`, and the cog menu stays closed.
  - **Local, keys:** with focus on the cog, pressing `k` leaves the fixture's `__keys` empty.
  - **Local, theme:** setting `DARK_ATTR` on `<html>` gives the wrapper `data-theme="dark"`, and removing it gives `light`.
  - **Local, settings link:** cog, then "Sieve settings", opens a tab at `chrome-extension://<id>/options.html#youtube`.
  - **Local, screenshots:** save `$SHOTS/yt-row-light.png` and `yt-row-dark.png`.
  - **Live, appearance:** the row appears under the player within 5 s of load.
  - **Live, no flicker:** 5 related-video navigations (the link from Task 2.2) give the same element, `data-mounts === '1'`, 0 removals and a minimum height above 0.
  - **Live, screenshot:** save `$SHOTS/yt-row-live.png`.
- [ ] **Step 2: Implement and run.** Run `pnpm --filter sieve build && pnpm --filter sieve test:yt -- --only row && pnpm --filter sieve test:e2e -- --live`. Expected: PASS. View both screenshots.
- [ ] **Step 3: Commit.** Commit with the message `Sieve: YouTube button row`.

### Task 2.5: Speed

**Files:**
- Create: `packages/sieve-core/src/playback.ts`, `src/__tests__/playback.test.ts`
- Create: `apps/sieve/src/yt/speed-main.ts`, `src/yt/speed.ts`, `apps/sieve/test/yt/speed.mjs`
- Modify: `apps/sieve/src/yt-main.ts`, `src/yt-relay.ts` (imports), `packages/sieve-core/package.json`

**Parallel:** after Task 2.4. Task 2.6 waits for it. It can run alongside Tasks 2.7 to 2.14. Shares the two entries and the core `package.json`.

**Interfaces:**
- Produces (core):
  ```ts
  export const MIN_RATE = 0.1;
  export const MAX_RATE = 16;
  export function nextSpeed(current: number, dir: 1 | -1, o: { step: number; anySpeed: boolean; rates: readonly number[] }): number;
  export function snapSpeed(rate: number, rates: readonly number[]): number;     // nearest; a tie goes to the lower rate
  export function formatSpeed(rate: number): string;
  export function nextVolume(current: number, dir: 1 | -1, step: number): number; // 0–100
  export interface WheelState { acc: number; at: number }
  export function wheelSteps(s: WheelState, deltaY: number, deltaMode: number, now: number, reverse: boolean): -1 | 0 | 1;
  ```
- `wheelSteps` rules:
  1. Convert to pixels: lines (`deltaMode` 1) × 40, pages (2) × 800.
  2. Reset `acc` when more than 300 ms passed since `at`, or when the sign changes.
  3. Add the pixels to `acc` and set `at = now`.
  4. At `|acc| >= 50`, reset `acc` and return `+1` for a wheel up (negative `deltaY`, faster or louder) or `-1` for down, flipped when `reverse`. At most one step per event.
- Main: `onVideo` applies `speed.default` when `setDefault` is on and the video is not live. Commands: `speed-step` (value ±1), `speed-set` (value: a rate), `speed-default` and `speed-normal`. It sends `rate` on `ratechange`.
- Isolated:
  - Row buttons:
    - `speed-down`: label "−", aria-label "Slower"
    - `speed`: label `formatSpeed(rate)`, aria-label "Speed 1.5×. Click for your default speed." with the current speed, `onClick` runs `speed-default`
    - `speed-up`: label "+", aria-label "Faster"
  - With `speed.wheel === 'over-speed'`, a `wheel` listener on the speed button (`passive: false`, `preventDefault`) sends `speed-step`.
  - `speed.ts` defines the actions `speed-down`, `speed-up`, `speed-default` (the default speed when `setDefault` is on, else 1×) and `speed-normal`. Each sends the matching main-world command. When a shortcut or the menu started it (not a row click), the row shows the toast "Speed 1.5×" with the new speed once the main state reports it.

- [ ] **Step 1: Inspect speed on the signed-out watch page, and record it in `speed-main.ts`.**
  - Does `setPlaybackRate(2.5)` take effect?
  - Does `video.playbackRate = 2.5` set directly stay after 5 s and after a seek?
  - Does YouTube re-apply a remembered speed to the next video, and at which event (`loadedmetadata` or the first `playing`)?
  - From this, choose how `anySpeed` sets a rate (directly on the video, or through the player) and when the default is applied: at `onVideo`, plus once more at the first `playing` if YouTube had changed it.
- [ ] **Step 2: Write the failing `playback.test.ts`.**
  - `nextSpeed` with `{ step: 0.25, anySpeed: true, rates: [] }`:
    - (1, +1) gives 1.25.
    - (1.1, +1) gives 1.25.
    - (1.1, −1) gives 1.
    - (16, +1) gives 16.
    - (0.1, −1) gives 0.1.
    - (0.3, +1) with step 0.1 gives exactly 0.4.
  - `nextSpeed` with `anySpeed: false` and `rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]`:
    - (2, +1) gives 2.
    - (1, +1) gives 1.25.
    - (1.1, +1) gives 1.25.
    - (1.1, −1) gives 1.
    - With `rates: []` it behaves as `anySpeed`.
  - `snapSpeed(1.6, rates)` gives 1.5, and `snapSpeed(1.625, rates)` gives 1.5.
  - `formatSpeed`: 1 gives `'1×'`, 1.25 gives `'1.25×'`, 1.5 gives `'1.5×'`, 0.1 gives `'0.1×'`, 16 gives `'16×'`, and 1.2000000001 gives `'1.2×'`.
  - `nextVolume`: (50, 1, 5) gives 55, (98, 1, 5) gives 100, and (3, −1, 5) gives 0.
  - `wheelSteps` from `{ acc: 0, at: 0 }`:
    - −100 at t=1000 gives 1, and 100 gives −1.
    - −100 with `reverse` gives −1.
    - Five events of +12 at 16 ms apart give 0, 0, 0, 0, −1.
    - `deltaMode` 1 with `deltaY` 3 gives −1.
    - +40 at 1000, then +40 at 1400, give 0 and 0.
    - +40, then −40, give 0 and 0.
- [ ] **Step 3: Run, implement, and run again.** Run `pnpm --filter @apps-hub/sieve-core test`. Expected: FAIL, then PASS.
- [ ] **Step 4: Write `test/yt/speed.mjs` and implement the app modules.**
  - **Local, default speed:** with `{ speed: { setDefault: true, default: 1.5 } }`, `video.playbackRate === 1.5` after load and after `navigate`, and the speed button reads "1.5×".
  - **Local, buttons:** clicking "Faster" gives 1.75 and "1.75×". With `anySpeed` on, 2 then "Faster" gives 2.25. With `anySpeed` off (the fixture's rates), it stays 2.
  - **Local, wheel:** `page.mouse.wheel(0, -100)` over the speed button adds one step. With `speed.wheel: 'off'`, the page scrolls instead (`scrollY` changes) and the rate stays.
  - **Local, shortcut path:** the worker sends `{ type: 'yt-command', action: 'speed-normal' }`, which gives 1 and the toast "Speed 1×".
  - **Live:** with the default 1.5, the rate is 1.5 three seconds into playback and again after one in-app navigation.
- [ ] **Step 5: Run the checks.** Run `pnpm --filter sieve build && pnpm --filter sieve test:yt -- --only speed && pnpm --filter sieve test:e2e -- --live`. Expected: PASS.
- [ ] **Step 6: Commit.** Commit with the message `Sieve: YouTube speed`.

### Task 2.6: Volume: default, booster and the mouse wheel

**Files:**
- Create: `apps/sieve/src/yt/volume-main.ts`, `src/yt/boost.ts`, `src/yt/wheel.ts`, `apps/sieve/test/yt/volume.mjs`
- Modify: `apps/sieve/src/yt-main.ts`, `src/yt-relay.ts` (imports)

**Parallel:** after Task 2.5 (it uses `playback.ts` and the speed actions). Shares the two entries.

**Interfaces:**
- Main: `onVideo` calls the player's volume setter with `level` when `setDefault` is on (and unmutes when `level > 0`), per Task 2.2's record. Command `volume-step` (value ±1) uses `nextVolume` and sends `volume`.
- `boost.ts`:
  - Row button `boost`: label "Boost volume", title "Boost volume ×2" with the current multiplier, pressed when `volume.boostOn`. Action `boost` calls `saveYouTube({ volume: { boostOn: !on } })`.
  - Routing rules, in this order:
    1. Nothing happens until `navigator.userActivation.hasBeenActive`. With boost on and no activation yet, one capture listener waits for the first trusted `pointerdown` or `keydown`, then removes itself.
    2. Only a video whose `src` starts with `blob:` is routed. Otherwise the toast says "Sieve can't boost this video."
    3. There is one `AudioContext` per frame. Call `await ctx.resume()`, and only when `ctx.state === 'running'` create one `MediaElementAudioSourceNode` per video element (kept in a `WeakMap`) and connect source → gain → destination.
    4. Off sets `gain.value = 1`. The graph stays, because a source node cannot be undone.
    5. A new video element is routed when boost is on.
  - The video element gets `sieve-boost="running"` while its gain is above 1, so the e2e can read the state if CDP cannot see contexts made in the isolated world.
- `wheel.ts`:
  - One `wheel` listener (`passive: false`) on `SEL.player`, plus right-button tracking (`mousedown` and `mouseup` with `button === 2`), added once per element.
  - When `speed.wheel === 'right-button'` and the button is held, it sends `speed-step`.
  - When `volume.wheel === 'over-video'` and the button is not held, or `'right-button'` and it is held, it sends `volume-step`.
  - It calls `preventDefault` only when it acted, and uses `reverseWheel`.
  - After a wheel step with the right button held, the next `contextmenu` is stopped in a capture listener on `document` (`preventDefault` and `stopImmediatePropagation`).
  - Toast "Volume 45%" on a volume change.

- [ ] **Step 1: Write `test/yt/volume.mjs` (failing).**
  - **Local, default volume:** with `{ volume: { setDefault: true, level: 30 } }`, `ytCalls` has the volume setter with 30 after load and again after `navigate`.
  - **Local, boost waits for a click:** with `boostOn` stored, load the fixture and play 2 s. CDP `WebAudio.enable` reports no `contextCreated`, `currentTime` advanced, and `video.muted` is false. Then `page.mouse.click` on an empty part of the page, and within 1 s there is one context in state `running`. It has a media element source connected to a gain node that is connected to the destination (CDP `nodesConnected`), or failing CDP visibility, `sieve-boost="running"`. The video keeps advancing.
  - **Local, button:** clicking "Boost volume" flips `aria-pressed` and `youtube.volume.boostOn`.
  - **Local, non-blob source:** with `src=direct`, Boost shows "Sieve can't boost this video." and creates no context.
  - **Local, wheel over the video:** with `volume.wheel: 'over-video'`, one `page.mouse.wheel(0, -100)` over the player gives the volume setter 55 (from 50), and `scrollY` is unchanged. With `'off'`, the page scrolls and the setter is not called.
  - **Local, right button for volume:** with `volume.wheel: 'right-button'`, a wheel without the button does nothing. `page.mouse.down({ button: 'right' })`, a wheel and `mouse.up({ button: 'right' })` call the setter, and `__ctx` stays empty.
  - **Local, right button for speed:** with `speed.wheel: 'right-button'`, the held button plus a wheel up gives rate +0.25.
  - **Local, reverse:** `reverseWheel` flips both directions.
  - **Live:** after a trusted click on "Boost volume", a running context or `sieve-boost="running"` exists, `currentTime` advances for 5 s, and the video is not muted. With the default 30, the player's volume reads 30.
- [ ] **Step 2: Implement and run.** Run `pnpm --filter sieve build && pnpm --filter sieve test:yt -- --only volume && pnpm --filter sieve test:e2e -- --live`. Expected: PASS.
- [ ] **Step 3: Commit.** Commit with the message `Sieve: YouTube volume, booster and wheel`.

### Task 2.7: Quality, H.264 and 30 fps

**Files:**
- Create: `packages/sieve-core/src/quality.ts`, `src/__tests__/quality.test.ts`
- Create: `apps/sieve/src/yt/quality-main.ts`, `src/yt/codecs-main.ts`, `apps/sieve/test/yt/quality.mjs`, `test/pages/yt/fullscreen.html`
- Modify: `apps/sieve/src/yt-main.ts` (import `codecs-main.ts` first), `packages/sieve-core/package.json`

**Parallel:** after Task 2.3. It needs no row. Shares `yt-main.ts` and the core `package.json`.

**Interfaces:**
- Produces (core):
  ```ts
  export function qualityContext(page: YtPage): 'videos' | 'playlists' | 'embeds';
  export function qualityTarget(ctx: 'videos' | 'playlists' | 'embeds', fullscreen: boolean, q: YouTubeSettings['quality']): QualityChoice;
  export function pickQuality(available: readonly string[], target: Quality): Quality | null;
  export function parseMediaType(type: string): { mime: string; codecs: string[]; params: Record<string, string> };
  export function refuseType(type: string, o: { h264: boolean; max30fps: boolean }): boolean;
  export function refuseConfig(config: unknown, o: { h264: boolean; max30fps: boolean }): boolean;  // only if Step 1 shows decodingInfo is called
  ```
  - `pickQuality` returns the highest known label at or below the target. If none is at or below, it returns the lowest available. Unknown labels and `'auto'` are ignored.
  - `refuseType` with `h264` refuses video types whose codecs include `vp8`, `vp9`, `vp09` or `av01`. Audio types are never refused. With `max30fps` it refuses a `framerate` (or the parameter Step 1 records) above 30.
- Main:
  - `codecs-main.ts` wraps, synchronously at `document_start`, the functions Step 1 found the player calling. The wrappers keep `this`, the original `name` and `length`. They refuse only after settings arrived with `h264` or `max30fps` on.
  - `quality-main.ts`:
    - On `onVideo` and on `fullscreenchange`, it computes `qualityTarget`.
    - On a new video it skips `'auto'`. Otherwise it waits for the available levels: every 250 ms for up to 10 s, cancelled by the next video. Then it sets `pickQuality` through the method Step 1 found working.
    - A full-screen change applies the target, `'auto'` included, so leaving full screen undoes a full-screen choice.
    - Commands `quality-auto` to `quality-highres` set that label through `pickQuality`.
    - It sends `quality` and `qualities`.

- [ ] **Step 1: Inspect the signed-out watch page with `page.addInitScript` wrappers, and record it in `codecs-main.ts` and `quality-main.ts`.**
  - Wrap `MediaSource.isTypeSupported`, `window.ManagedMediaSource?.isTypeSupported`, `HTMLMediaElement.prototype.canPlayType` and `navigator.mediaCapabilities.decodingInfo`. On a hard load of `dQw4w9WgXcQ` and after an in-app navigation, record call counts and the first 20 distinct arguments of each, and whether the calls come before or after `#movie_player` exists.
  - For quality, record:
    - whether `setPlaybackQualityRange(l, l)` or `setPlaybackQuality(l)` changes `getPlaybackQuality()` within 5 s
    - what `getAvailableQualityLevels()` returns, in order
    - a way to read the playing codec (a player method, or the "Stats for nerds" panel text); if none is found, the owner checklist covers it
- [ ] **Step 2: Write the failing `quality.test.ts`.**
  - `qualityContext` gives `'videos'` for a watch page, `'playlists'` with `list`, and `'embeds'` for an embed.
  - `qualityTarget` with `videos: 'hd720'`:
    - not full screen gives `'hd720'`
    - full screen with `videosFull: 'same'` gives `'hd720'`
    - full screen with `videosFull: 'hd1080'` gives `'hd1080'`
    - `videos: 'auto'` with `'same'` gives `'auto'`
  - `pickQuality`:
    - (`['hd1080','hd720','large','medium','small','tiny','auto']`, `'hd1440'`) gives `'hd1080'`, and the same list with `'large'` gives `'large'`.
    - (`['hd720','large']`, `'tiny'`) gives `'large'`.
    - (`[]`, `'hd720'`) and (`['auto','weird']`, `'hd720'`) give `null`.
  - `refuseType` with `{ h264: true, max30fps: false }`:
    - `'video/webm; codecs="vp9"'` gives true, and `'video/mp4; codecs="av01.0.08M.08"'` gives true.
    - `'video/mp4; codecs="avc1.640028"'` gives false, and `'audio/webm; codecs="opus"'` gives false.
  - `refuseType` with `max30fps: true`: `'video/mp4; codecs="avc1.640028"; framerate=60'` gives true, while `framerate=30` and `framerate=29.97` give false.
  - With both off, nothing is refused. `''` gives false.
  - Step 1's recorded strings are added as cases, with their expected answers.
- [ ] **Step 3: Run, implement, and run again.** Run `pnpm --filter @apps-hub/sieve-core test`. Expected: FAIL, then PASS.
- [ ] **Step 4: Write `test/yt/quality.mjs` and implement the app modules.** `fullscreen.html` is the watch fixture plus a "Full screen" button whose click handler calls `#movie_player.requestFullscreen()`, so a trusted Playwright click can enter full screen.
  - **Local, videos:** with `quality.videos: 'hd720'`, `ytCalls` has the recorded setter with `'hd720'`.
  - **Local, playlists:** with `list=PLsieve&index=1` and `playlists: 'large'`, the setter gets `'large'`.
  - **Local, full screen:** on `fullscreen.html` with `videosFull: 'hd1080'`, clicking "Full screen" gives `'hd1080'`, and `document.exitFullscreen()` gives `'hd720'` again.
  - **Local, embed:** the `embed-host.html` frame with `embeds: 'medium'` gives `'medium'`.
  - **Local, codecs with H.264 on:** page-evaluated `MediaSource.isTypeSupported('video/webm; codecs="vp9"') === false`, `('video/mp4; codecs="avc1.4d401f"') === true` and `('audio/webm; codecs="opus"') === true`, and `MediaSource.isTypeSupported.name === 'isTypeSupported'`. With H.264 off, vp9 answers true.
  - **Local, codecs with 30 fps:** Step 1's 60 fps string answers false.
  - **Live, quality:** with `videos: 'hd720'`, `getPlaybackQuality()` (or the recorded equivalent) is `'hd720'` within 10 s.
  - **Live, H.264:** with `h264` on, the recorded codec reading contains `avc1`.
- [ ] **Step 5: Run the checks.** Run `pnpm --filter sieve build && pnpm --filter sieve test:yt -- --only quality && pnpm --filter sieve test:e2e -- --live`. Expected: PASS.
- [ ] **Step 6: Commit.** Commit with the message `Sieve: YouTube quality, H.264 and 30 fps`.

### Task 2.8: Loop, stop and reversed playlist

**Files:**
- Create: `packages/sieve-core/src/time.ts`, `src/__tests__/time.test.ts`
- Create: `apps/sieve/src/yt/loop.ts` (isolated), `src/yt/playlist-main.ts` (main), `apps/sieve/test/yt/loop.mjs`
- Modify: `apps/sieve/src/yt-main.ts`, `src/yt-relay.ts` (imports), `packages/sieve-core/package.json`

**Parallel:** after Task 2.4. Shares the two entries and the core `package.json`.

**Interfaces:**
- Produces (core):
  ```ts
  export function parseTime(text: string): number | null;   // '75', 'm:ss', 'h:mm:ss'; seconds and minutes after a colon are two digits below 60
  export function formatTime(seconds: number): string;      // floor; '0:05', '1:05', '1:02:03'
  export interface LoopPart { start: number; end: number }
  export function loopSeek(t: number, part: LoopPart | null, duration: number): number | null;
  ```
  `loopSeek` clamps `end` to `duration`. It returns `null` without a part, or when `end <= start`. It returns `start` when `t >= end - 0.05`, and `null` otherwise.
- Isolated (`loop.ts`):
  - Row button `loop`: label "Loop", pressed from `video.loop`. The click toggles `video.loop`. The `menu` part has the label "Loop options" and opens a popover with:
    - a switch "Loop this video"
    - "From" and "To" text inputs (placeholders "0:00" and the video's length), each with a "Now" button that fills in the current time
    - a "Clear" button that clears the part
    - an invalid time shows "Enter a time like 1:05 or 75." under the input
  - With a part set and the loop on, a `timeupdate` listener (one per element) seeks through `loopSeek`.
  - The loop and the part reset on each new video. Action `loop`.
  - Cog items, from the main state: "Stop", and "Reverse playlist", which is visible only with a playlist and checked from `state.playlist.reversed`. Both are forwarded actions.
- Main (`playlist-main.ts`):
  - `stop` uses the method Task 2.2 recorded (`stopVideo`, or `pauseVideo` plus a seek to 0).
  - `reverse-playlist` toggles the reversal for this tab. It resets when the address's `list` changes.
  - While reversed, on `timeupdate` with `duration - currentTime < 0.6`, not looping, and once per video, it moves to the previous item through the method Step 1 confirms (for example `playVideoAt(index - 1)`). At the first item it does nothing.
  - It sends `playlist`.

- [ ] **Step 1: Inspect a public playlist signed out, and record it in `playlist-main.ts`.**
  - The index base of `getPlaylistIndex()`.
  - Which call moves to another item.
  - Whether calling it 0.5 s before the end comes before YouTube's own advance.
  - What `stopVideo` leaves on screen.
- [ ] **Step 2: Write the failing `time.test.ts`.**
  - `parseTime`: `'75'` gives 75, `'1:05'` gives 65, `'1:02:03'` gives 3723, and `''`, `'1:5'`, `'1:60'`, `'-3'` and `'a'` give `null`.
  - `formatTime`: 5 gives `'0:05'`, 65 gives `'1:05'`, 3723 gives `'1:02:03'`, and 59.9 gives `'0:59'`.
  - `loopSeek` with `{ start: 5, end: 10 }` and duration 60:
    - t=10 gives 5, and 9.96 gives 5.
    - 9.9 gives `null`.
    - 3 gives `null`.
  - `loopSeek(59.97, { start: 5, end: 100 }, 60)` gives 5.
  - `loopSeek(1, { start: 10, end: 5 }, 60)` and `loopSeek(1, null, 60)` give `null`.
- [ ] **Step 3: Run, implement, and run again.** Run `pnpm --filter @apps-hub/sieve-core test`. Expected: FAIL, then PASS.
- [ ] **Step 4: Write `test/yt/loop.mjs` and implement the app modules.**
  - **Local, loop toggle:** clicking "Loop" gives `video.loop === true` and `aria-pressed="true"`. After `navigate` it is `false`.
  - **Local, loop part:** with "From" `0:01` and "To" `0:02` on the 5 s tone, after 4 s of playback, `currentTime` sampled every 100 ms stayed between 0.9 and 2.1.
  - **Local, bad time:** "From" `1:5` shows "Enter a time like 1:05 or 75.".
  - **Local, typing:** typing `1` in "From" leaves the fixture's `__keys` empty.
  - **Local, shortcut path:** `yt-command` `loop` toggles the loop.
  - **Local, tools off:** with `youtube.on` false, `yt-command` `loop` leaves `video.loop` false.
  - **Local, reversed playlist:** with `list=PLsieve&index=3` and reversed on, near the end `ytCalls` has the recorded previous-item call and no next-item call. At the first item there is no call.
  - **Local, stop:** "Stop" makes the recorded call.
  - **Local, cog items:** "Reverse playlist" shows in the cog menu only with `list`.
  - **Live, loop:** with "Loop" on, set `currentTime = duration - 1`, and 3 s later `currentTime < 3`.
  - **Live, stop:** "Stop" leaves the player in the state Step 1 recorded.
- [ ] **Step 5: Run the checks.** Run `pnpm --filter sieve build && pnpm --filter sieve test:yt -- --only loop && pnpm --filter sieve test:e2e -- --live`. Expected: PASS.
- [ ] **Step 6: Commit.** Commit with the message `Sieve: YouTube loop, stop and reversed playlist`.

### Task 2.9: Screenshot and picture-in-picture

**Files:**
- Create: `packages/sieve-core/src/screenshot.ts`, `src/__tests__/screenshot.test.ts`
- Create: `apps/sieve/src/yt/capture.ts`, `apps/sieve/test/yt/capture.mjs`
- Modify: `apps/sieve/src/yt-handler.ts` (`yt-screenshot`), `src/__tests__/yt-handler.test.ts`, `src/manifest.json` (adds the `downloads` permission), `src/yt-relay.ts` (import), `packages/sieve-core/package.json`

**Parallel:** after Task 2.4. It shares `yt-handler.ts` and its test with Task 2.11, so run them one after the other or claim both files. It shares `manifest.json` and `yt-relay.ts`.

**Interfaces:**
- Produces (core):
  ```ts
  export function screenshotName(title: string, seconds: number): string;
  export function isPngDataUrl(s: unknown, maxBytes: number): s is string;
  export function flipFromMatrix(transform: string): { h: boolean; v: boolean };
  ```
  `screenshotName` builds `<title> <h-mm-ss or m-ss>.png`:
  - Each run of `\ / : * ? " < > |` or control characters becomes one space.
  - Spaces collapse, and leading dots and spaces go.
  - The title is cut to 120 characters, and an empty title becomes "YouTube video".
- Isolated (`capture.ts`):
  - Row button `screenshot`: label "Screenshot". Action `screenshot`:
    1. It needs `video.readyState >= 2`, else the toast says "Sieve can't take a screenshot yet. Play the video first."
    2. It draws a canvas at `videoWidth × videoHeight`, with `ctx.filter` set to the video's computed `filter` and the flips taken from `flipFromMatrix` of its computed `transform`, so the picture matches the screen.
    3. `canvas.toBlob('image/png')`. A `SecurityError` shows the toast "Sieve can't take a screenshot of this video."
    4. It reads the blob as a data URL and sends `{ type: 'yt-screenshot', dataUrl, title: mainState()?.title ?? '', seconds: video.currentTime }`. On success the toast says "Screenshot saved". On failure it says "Sieve couldn't save the screenshot: " followed by the message.
  - Row button `pip`, just after `screenshot`: `label: 'Picture-in-picture'` (the tooltip; the `icon`, an inline SVG with no emoji, replaces the visible text), aria-label "Picture-in-picture", `pressed` when `document.pictureInPictureElement` is the video. Action `pip`: it calls `video.requestPictureInPicture()`, or `document.exitPictureInPicture()` when PiP is already open. `notifyActions()` runs on the video's `enterpictureinpicture` and `leavepictureinpicture` events (one listener per element). A `NotAllowedError` shows the toast "Chrome only opens picture-in-picture from a click on the page. Use the Picture-in-picture button under the video." In an embed frame there is no row, so the error is not shown.
- Worker: `yt-screenshot` checks `isPngDataUrl(dataUrl, 64 * 1024 * 1024)`, else it answers `{ ok: false, message: 'the picture is not a PNG or is too big' }`. Then it calls `chrome.downloads.download({ url: dataUrl, filename: 'Sieve/' + screenshotName(String(title), Number(seconds) || 0), conflictAction: 'uniquify', saveAs: false })` and answers `{ ok: true }` or the error's message. Chrome creates the `Sieve` subfolder in Downloads, so the file lands at `Downloads/Sieve/<title> <time>.png`. `screenshotName` removes `/`, so a title cannot change the folder. These downloads have `byExtensionId === chrome.runtime.id`, which phase 3's take-over must skip.

- [ ] **Step 1: Inspect PiP and record the answer in `capture.ts`.** In the signed-out watch page, check:
  - whether `video.requestPictureInPicture()` succeeds from a trusted click in the page
  - whether it succeeds from a `yt-command` message, which carries no click
  - what headless Chrome for Testing answers
- [ ] **Step 2: Write the failing tests.**
  - `screenshotName`:
    - `('Rick Astley - Never Gonna Give You Up (Official Video)', 3723)` gives `'Rick Astley - Never Gonna Give You Up (Official Video) 1-02-03.png'`.
    - `('a/b:c*?"<>|d', 5)` gives `'a b c d 0-05.png'`.
    - `('', 5)` gives `'YouTube video 0-05.png'`.
    - `('...hidden', 5)` gives `'hidden 0-05.png'`.
    - `('a'.repeat(300), 5)` gives `'a'.repeat(120) + ' 0-05.png'`.
    - `('\u0000ctrl', 1)` gives `'ctrl 0-01.png'`.
  - `isPngDataUrl`: `'data:image/png;base64,iVBORw0KGgo='` is true. A JPEG data URL, `42`, and a PNG data URL longer than `maxBytes` are false.
  - `flipFromMatrix`: `'none'` gives `{ h: false, v: false }`, `'matrix(-1, 0, 0, 1, 0, 0)'` gives `{ h: true, v: false }`, and `'matrix(-1, 0, 0, -1, 0, 0)'` gives both true.
  - `yt-handler.test.ts`: a PNG data URL calls `downloads.download` with the filename `'Sieve/' + screenshotName(title, seconds)` (for example `'Sieve/a b c d 0-05.png'` for the title `a/b:c*?"<>|d` at 5 s) and `conflictAction: 'uniquify'`. A JPEG answers `ok: false` without calling it.
- [ ] **Step 3: Run, implement, and run again.** Run `pnpm --filter @apps-hub/sieve-core test && pnpm --filter sieve test`. Expected: FAIL, then PASS.
- [ ] **Step 4: Write `test/yt/capture.mjs`.**
  - **Local, click:** on `canvas=1`, "Screenshot" gives a newest download with `state: 'complete'`, `mime: 'image/png'` and `byExtensionId` equal to the extension id. Its `filename` ends in `.png` and its folder is named `Sieve`. Read its file in Node: the PNG signature is there, and IHDR width 320 and height 180. The toast says "Screenshot saved".
  - **Local, unplayable:** `state=unplayable` shows "Sieve can't take a screenshot yet. Play the video first." and makes no download.
  - **Local, shortcut path:** `yt-command` `screenshot` (no click) also downloads.
  - **Local, page clicks:** a page script's `click()` on the Screenshot button makes no download.
  - **Local, PiP:** a trusted click on the row's "Picture-in-picture" button gives `document.pictureInPictureElement === video` and `aria-pressed="true"`. If Step 1 found that headless refuses PiP with `NotSupportedError`, the check accepts that error (the button stays unpressed), and PiP goes on the owner checklist.
  - **Local, PiP button position:** the row's button order has "Picture-in-picture" right after "Screenshot".
  - **Live:** after 5 s of playback, "Screenshot" gives a PNG download whose IHDR size equals the video's `videoWidth × videoHeight`.
- [ ] **Step 5: Run the checks.** Run `pnpm --filter sieve build && pnpm --filter sieve test:yt -- --only capture && pnpm --filter sieve test:e2e -- --live`. Expected: PASS.
- [ ] **Step 6: Commit.** Commit with the message `Sieve: YouTube screenshot and picture-in-picture`.

### Task 2.10: Cinema, expand, theater, flip and filters

**Files:**
- Create: `packages/sieve-core/src/visual.ts`, `src/__tests__/visual.test.ts`
- Create: `apps/sieve/src/yt/visual.ts`, `src/yt/visual.css`, `apps/sieve/test/yt/visual.mjs`
- Modify: `apps/sieve/src/yt-relay.ts` (import), `packages/sieve-core/package.json`

**Parallel:** after Task 2.4. Shares `yt-relay.ts` and the core `package.json`.

**Interfaces:**
- Produces (core):
  ```ts
  export function filterCss(f: VideoFilters): string;               // 'none' when every value is the default
  export function flipTransform(h: boolean, v: boolean): string;    // 'none' | 'scale(-1, 1)' | 'scale(1, -1)' | 'scale(-1, -1)'
  export function backdropColor(hex: string, opacity: number): string;
  ```
  `filterCss` lists only the values that differ from the default, in the order blur, brightness, contrast, grayscale, hue-rotate, invert, saturate, sepia. Units: `px` for blur, `deg` for hue, and `%` for the rest.
- Isolated (`visual.ts`, with CSS gated by `sieve-yt` tokens and custom properties):
  - **Cinema** (`player.cinema`, stored):
    - flag `cinema`
    - a `<sieve-yt-backdrop>` element appended to `<body>`, covering the viewport, with the background `backdropColor(backdrop, backdropOpacity)`
    - CSS raises `SEL.playerBox`, `SEL.theaterBox` and the row above it
    - a trusted click on the backdrop turns cinema off through `saveYouTube`
    - row button `cinema`: label "Cinema", pressed; action `cinema`
  - **Expand** (`player.expand`, stored):
    - flag `expand`
    - turns theater on by clicking `SEL.sizeButton` if `THEATER_ATTR` is absent
    - CSS gives `SEL.theaterBox` the height of the viewport minus `SEL.masthead`, with the property Step 1 records
    - dispatches a `resize` event on `window` after each change
    - row button `expand`: label "Expand"; action `expand`
  - **Auto theater:** on each watch `onNavigate` with `player.autoTheater` on and `THEATER_ATTR` absent, it clicks `SEL.sizeButton` once.
  - **Flip** (per video):
    - row button `flip`: label "Flip"; the main part toggles horizontal; its `menu` part, "Flip options", has the switches "Flip horizontally" and "Flip vertically"
    - sets `--sieve-yt-flip` on `SEL.player` from `flipTransform`
    - resets on each new video
    - actions `flip-h` and `flip-v`
  - **Filters** (`player.filtersOn` and `player.filters`, stored):
    - row button `filters`: label "Filters"; the main part toggles `filtersOn`
    - its `menu` part, "Filter options", has:
      - a switch "Filters on"
      - eight sliders with the value shown after each: "Blur" (`3 px`), "Brightness" (`120%`), "Contrast", "Grayscale", "Hue" (`90°`), "Invert", "Saturation" and "Sepia"
      - a "Reset" button
    - each slider sets `--sieve-yt-filter` on `input` and saves on `change` only
    - action `filters`

- [ ] **Step 1: Inspect, and record it in `visual.ts`.**
  - The `z-index` the backdrop needs above the masthead.
  - What limits the theater player's height (element and property).
  - Whether YouTube re-lays out the video on a `window` `resize`.
  - Whether YouTube sets an inline `transform` or `filter` on the video.
- [ ] **Step 2: Write the failing `visual.test.ts`.**
  - `filterCss` of the defaults gives `'none'`. Blur 2 and hue 90 give `'blur(2px) hue-rotate(90deg)'`. Brightness 120 gives `'brightness(120%)'`.
  - `flipTransform`: (false, false) gives `'none'`, (true, false) gives `'scale(-1, 1)'`, and (true, true) gives `'scale(-1, -1)'`.
  - `backdropColor('#336699', 50)` gives `'rgba(51, 102, 153, 0.5)'`, and `('#000000', 85)` gives `'rgba(0, 0, 0, 0.85)'`.
- [ ] **Step 3: Run, implement, and run again.** Run `pnpm --filter @apps-hub/sieve-core test`. Expected: FAIL, then PASS.
- [ ] **Step 4: Write `test/yt/visual.mjs` and implement the app module.**
  - **Local, cinema:**
    - "Cinema" makes `document.elementFromPoint(5, innerHeight - 5)` the backdrop, and the player's centre point lands inside `SEL.player`. The backdrop's computed background is `'rgba(0, 0, 0, 0.85)'`.
    - A click on the backdrop stores `player.cinema === false` and hides the backdrop.
    - Backdrop `#336699` at 50 gives `'rgba(51, 102, 153, 0.5)'`.
    - A second fixture tab follows the stored change without a reload.
  - **Local, expand:** "Expand" sets the theater attribute, and `SEL.theaterBox`'s height equals `innerHeight` minus the masthead's height, ±1 px.
  - **Local, auto theater:** with it on, a load gives theater. After `navigate` it is still theater, and the fixture's size button was clicked once.
  - **Local, flip:**
    - "Flip" gives the video a computed transform of `matrix(-1, 0, 0, 1, 0, 0)`.
    - "Flip vertically" gives `matrix(-1, 0, 0, -1, 0, 0)`.
    - After `navigate` it is `none`.
  - **Local, filters:**
    - "Filters" turns them on, with a computed `filter` of `none`.
    - Three ArrowRight presses on the "Blur" slider give `blur(3px)`. A `storage.onChanged` counter in the worker saw at most 2 writes of `youtube` for the drag, and `youtube.player.filters.blur === 3`.
    - "Reset" gives `none`.
  - **Live, cinema:** the `elementFromPoint` checks hold on the real page.
  - **Live, expand:** the theater container's height is within 2 px of the viewport minus the masthead.
  - **Live, flip:** the real video's computed transform flips.
  - **Live, screenshot:** save `$SHOTS/yt-cinema.png`.
- [ ] **Step 5: Run the checks.** Run `pnpm --filter sieve build && pnpm --filter sieve test:yt -- --only visual && pnpm --filter sieve test:e2e -- --live`. Expected: PASS.
- [ ] **Step 6: Commit.** Commit with the message `Sieve: YouTube cinema, expand, theater, flip and filters`.

### Task 2.11: Autoplay rules

**Files:**
- Create: `packages/sieve-core/src/autoplay.ts`, `src/__tests__/autoplay.test.ts`
- Create: `apps/sieve/src/yt/autoplay.ts`, `apps/sieve/test/yt/autoplay.mjs`
- Modify: `apps/sieve/src/yt-handler.ts` (`yt-playing`), `src/__tests__/yt-handler.test.ts`, `src/yt-relay.ts` (import; the `yt-pause` handler), `packages/sieve-core/package.json`

**Parallel:** after Task 2.3. It needs no row. It shares `yt-handler.ts` and its test with Task 2.9, so run them one after the other or claim both files. Shares `yt-relay.ts`.

**Interfaces:**
- Produces (core):
  ```ts
  export interface PlayContext { mode: AutoplayMode; playlists: boolean; loadedHidden: boolean; firstVideo: boolean; inPlaylist: boolean;
                                 firstPlay: boolean; sincePlayerInput: number }   // ms since the last trusted click or key in the player; Infinity if none
  export function stopThisPlay(c: PlayContext): boolean;
  ```
  Rules, in order:
  1. A play that is not `firstPlay` is never stopped.
  2. `sincePlayerInput < 1000` (the owner pressed play) is never stopped.
  3. `'allow'` never stops.
  4. `'background'` stops when `loadedHidden && firstVideo`.
  5. `'always'` stops unless `playlists && inPlaylist`.
- Isolated (`autoplay.ts`):
  - It records `loadedHidden` once (`document.visibilityState === 'hidden'` at script start) and the time of trusted `pointerdown` and `keydown` events inside `SEL.player` (capture).
  - On the video's `play` event (one listener per element), when `stopThisPlay` says so, it pauses the video in the way Task 2.2 found keeps YouTube's play button right.
  - With `pauseOthers`, on `playing` it sends `{ type: 'yt-playing', token }`, where the token is random per frame. It answers `{ type: 'yt-pause', except }` by pausing a playing video when `except !== token`.
- Worker: `yt-playing` adds `sender.tab.id` to session `ytPlayers`. It sends `{ type: 'yt-pause', except: token }` to every tab in the set, the sender's own tab included, so its other frames hear it. It drops ids whose send fails because no content script answers.

- [ ] **Step 1: Write the failing `autoplay.test.ts`.** Base context: `{ mode: 'always', playlists: true, loadedHidden: false, firstVideo: true, inPlaylist: false, firstPlay: true, sincePlayerInput: Infinity }`.
  - The base context gives true.
  - `firstPlay: false` gives false, and `sincePlayerInput: 500` gives false.
  - `mode: 'allow'` gives false.
  - `inPlaylist: true` gives false, and `inPlaylist: true` with `playlists: false` gives true.
  - `mode: 'background'` gives false. With `loadedHidden: true` it gives true. With `loadedHidden: true` and `firstVideo: false` it gives false.
  - `yt-handler.test.ts`:
    - `yt-playing` from tab 3 with tabs 3 and 5 in the set sends `yt-pause` to both.
    - A send to tab 5 rejecting with "Receiving end does not exist" removes 5 from `ytPlayers`.
- [ ] **Step 2: Run, implement, and run again.** Run `pnpm --filter @apps-hub/sieve-core test && pnpm --filter sieve test`. Expected: FAIL, then PASS.
- [ ] **Step 3: Write `test/yt/autoplay.mjs`.**
  - **Local, every tab:** with `mode: 'always'`, the fixture's autoplay is paused within 500 ms of load, with `currentTime < 0.5`. A trusted click on the fixture's play control plays it, and it keeps playing for 2 s. After `navigate`, the next video is paused again. With `list=PLsieve&index=1` it plays.
  - **Local, background tabs:** with `mode: 'background'`, open the fixture in a page behind another page and check its `document.visibilityState`. If headless reports it as `visible`, run this one check in a headed launch (`headless: false`), as the spike did for bot checks. Bring it to the front: it is paused. A second load in the front plays.
  - **Local, pause others:** with `pauseOthers`, tabs A and B on the fixture with `mode: 'allow'`. When B plays, A pauses within 1 s. An `embed-host.html` tab whose embed is playing pauses when A plays.
  - **Live:** with `mode: 'always'`, 3 s after load the real player is paused, with `currentTime < 1`. A trusted click on the player plays it.
- [ ] **Step 4: Implement and run.** Run `pnpm --filter sieve build && pnpm --filter sieve test:yt -- --only autoplay && pnpm --filter sieve test:e2e -- --live`. Expected: PASS.
- [ ] **Step 5: Commit.** Commit with the message `Sieve: YouTube autoplay rules`.

### Task 2.12: Page tidying

**Files:**
- Create: `packages/sieve-core/src/tidy.ts`, `src/__tests__/tidy.test.ts`
- Create: `apps/sieve/src/yt/tidy.ts`, `src/yt/tidy.css`, `apps/sieve/test/pages/yt/watch-full.html`, `test/pages/yt/browse.html`, `apps/sieve/test/yt/tidy.mjs`
- Modify: `apps/sieve/src/yt-relay.ts` (import), `packages/sieve-core/package.json`

**Parallel:** after Task 2.3. It needs no row. Shares `yt-relay.ts` and the core `package.json`.

**Interfaces:**
- Produces (core): `export function shortsToWatch(url: string): string | null;`. It takes an absolute `https://www.youtube.com/shorts/<11-character id>` address (any query) and returns `https://www.youtube.com/watch?v=<id>`. Anything else gives `null`.
- Isolated (`tidy.ts`, selectors at the top with inspection comments):
  - **Flags:** `hide-shorts`, `hide-related`, `hide-comments`, `hide-chat` and `hide-cards` are set from settings in the `onSettings` call at `document_start`. `tidy.css` holds the rules for each.
  - **Per row:** `setStyle('per-row', …)` sets each non-zero count on the custom property Step 1 records for home, channel, Shorts and Posts. 0 writes nothing.
  - **Convert Shorts:** when `onSettings` finds `kind === 'shorts'`, it calls `location.replace(shortsToWatch(location.href))`. A capture `click` listener on `document` catches a trusted click on a link to a Short: it calls `preventDefault` and `stopImmediatePropagation`, then `location.assign(watch)`. `onNavigate` to a Short also calls `location.replace`.
  - **Newest comments:** on each watch `onNavigate`, an observer on the comments container (`childList` and `subtree`, scoped to that element only, disconnected after use, after 60 s, or on the next navigation) waits for the sort menu. It then picks the newest-first item, found the way Step 1 records, once per video.
  - **Expand description:** on each watch `onNavigate`, it waits up to 10 s for the expander (a scoped observer), then clicks it once per video.
  - **Actions:** `comments`, `related` and `cards` toggle their stored setting through `saveYouTube`.

- [ ] **Step 1: Inspect the signed-out pages, and record each item in `tidy.ts`.**
  - **Shorts:**
    - a Shorts shelf on a search results page (signed-out home may be empty: record what it shows)
    - the Shorts entry in the side guide
    - a channel's Shorts tab
    - single Shorts items in grids
  - **Watch page:** the related column, the comments section, and the live chat container (find a public live stream).
  - **Comments sort menu:** its newest-first item, with a way to pick it that does not depend on the language (record the profile's language).
  - **Description:** the expander.
  - **Info cards and end screens:** their elements.
  - **Videos per row:** the custom properties the grid reads on home (or search), a channel's Videos tab, its Shorts tab and its Posts tab (`getComputedStyle`, names containing `per-row`).
  - Prefer attributes and element names to generated class names. Avoid `:has()` unless no attribute or element name does the job.
- [ ] **Step 2: Write the failing `tidy.test.ts`.**
  - `shortsToWatch('https://www.youtube.com/shorts/dQw4w9WgXcQ')` and `…?feature=share` give `'https://www.youtube.com/watch?v=dQw4w9WgXcQ'`.
  - `'https://www.youtube.com/shorts/'`, `'https://www.youtube.com/shorts/short'`, `'https://www.youtube.com/watch?v=dQw4w9WgXcQ'` and `'/shorts/dQw4w9WgXcQ'` give `null`.
- [ ] **Step 3: Run, implement, and run again.** Run `pnpm --filter @apps-hub/sieve-core test`. Expected: FAIL, then PASS.
- [ ] **Step 4: Write the fixtures, `test/yt/tidy.mjs` and the app module.**
  - **Fixtures:** `watch-full.html` is the watch fixture plus Step 1's related column, comments with a sort menu, description expander, cards, end screen and chat container. `browse.html` has a Shorts shelf, a grid with a Short, and a channel-style grid, with the recorded custom properties in use.
  - **Local, hiding:**
    - Each hide switch gives its element computed `display: none`, and turning it off shows it again.
    - With "Hide Shorts" stored before load, the shelf is never painted visible: an inline script right after the shelf records `getComputedStyle(shelf).display` in its first `requestAnimationFrame`, and it is `'none'`.
  - **Local, per row:** "Videos per row on Home" 3 gives the recorded property computed as `3`.
  - **Local, convert Shorts:**
    - A trusted click on a Short's link in `browse.html` loads `/watch?v=<id>`, a new document.
    - Loading `/shorts/sieveTest01?fixture=browse` ends at `/watch?v=sieveTest01`.
    - With the switch off, both stay.
  - **Local, newest comments:** the fixture's sort menu records that the newest item was chosen, once.
  - **Local, description:** the fixture's expander shows the expanded state Step 1 recorded.
  - **Local, shortcut path:** `yt-command` `comments` toggles `tidy.hideComments`.
  - **Live, selectors:** every recorded selector finds its element on its real page.
  - **Live, effects:**
    - "Hide comments" hides the real comments.
    - "Videos per row on channel pages" 3 applies on a channel's Videos tab.
    - After scrolling to the comments, the newest-first item is selected.
- [ ] **Step 5: Run the checks.** Run `pnpm --filter sieve build && pnpm --filter sieve test:yt -- --only tidy && pnpm --filter sieve test:e2e -- --live`. Expected: PASS.
- [ ] **Step 6: Commit.** Commit with the message `Sieve: YouTube page tidying`.

### Task 2.13: Theme and my CSS

**Files:**
- Create: `apps/sieve/src/yt/theme.ts`, `src/yt/theme.css`, `apps/sieve/test/pages/yt/theme.html`, `apps/sieve/test/yt/theme.mjs`
- Modify: `apps/sieve/src/yt-relay.ts` (import)

**Parallel:** after Task 2.3. It needs no row. Shares `yt-relay.ts`.

**Interfaces:**
- Isolated (`theme.ts`, no core logic; `ACCENTS` comes from Task 2.1):
  - **Dark theme:** `theme.dark` sets YouTube's dark-theme attributes from Step 1 on `<html>` in the `document_start` settings call, in every page kind including chat frames. If Step 1 found that YouTube removes them, an attribute observer on `<html>` only puts them back. Turning it off removes only what Sieve added.
  - **Accent:** `theme.accent` calls `setStyle('accent', …)`, which maps Step 1's variables and selectors to the accent's hex. `'youtube'` writes nothing.
  - **My CSS:** `theme.css` calls `setStyle('my-css', theme.css)`, which sets the CSS as the style element's `textContent`, never as HTML.
  - **YouTube tools off:** all three are removed.

- [ ] **Step 1: Inspect, and record it in `theme.ts`.**
  - How YouTube switches to its dark theme (attributes on `<html>` and elsewhere), and whether it undoes an added attribute on a light profile.
  - The custom properties or selectors behind YouTube's red accents: the progress bar, the scrubber, the subscribe button and the live badge.
  - The same items in a live chat frame.
- [ ] **Step 2: Write `theme.html` and `test/yt/theme.mjs`, then implement.** `theme.html` has a progress bar styled the way Step 1 records. If Step 1 found YouTube removes the attribute, it also has a script that does the same.
  - **Local, dark theme:** with "Dark theme" stored, an inline script at the top of `<body>` records in its first `requestAnimationFrame` whether `<html>` has the recorded attribute: true. The fixture's remover script runs, and the attribute is back within one frame.
  - **Local, accent:** accent `blue` gives the progress bar a computed background of `rgb(30, 136, 229)`.
  - **Local, my CSS:**
    - `body { outline: 3px solid rgb(1, 2, 3) }` gives a computed outline colour of `rgb(1, 2, 3)`.
    - The CSS `</style><script>window.__pwned = 1</script>` leaves `window.__pwned` undefined, and that text is inside the style element.
  - **Local, YouTube tools off:** with `youtube.on` false, none of the three applies.
  - **Live, dark theme:** the real page's background is dark (relative luminance of the recorded background element below 0.1).
  - **Live, accent:** accent blue colours the progress bar.
  - **Live, screenshot:** save `$SHOTS/yt-theme.png`.
- [ ] **Step 3: Run the checks.** Run `pnpm --filter sieve build && pnpm --filter sieve test:yt -- --only theme && pnpm --filter sieve test:e2e -- --live`. Expected: PASS.
- [ ] **Step 4: Commit.** Commit with the message `Sieve: YouTube theme and my CSS`.

### Task 2.14: Experiments manager

**Files:**
- Create: `packages/sieve-core/src/experiments.ts`, `src/__tests__/experiments.test.ts`, `src/__tests__/fixtures/yt/experiment-flags.json`
- Create: `apps/sieve/src/yt/experiments-main.ts`, `apps/sieve/test/pages/yt/experiments.html`, `apps/sieve/test/yt/experiments.mjs`
- Modify: `apps/sieve/src/yt-main.ts` (import, after `codecs-main.ts`), `packages/sieve-core/package.json`

**Parallel:** after Task 2.3. It needs no row. Shares `yt-main.ts` and the core `package.json`. Task 2.16 waits for it.

**Interfaces:**
- Produces (core):
  ```ts
  export type FlagValue = boolean | number | string;
  export const EXPERIMENT_PRESETS: readonly { id: string; label: string; flags: Record<string, FlagValue> }[];   // from Step 1
  export function parseFlagOverrides(text: string): { flags: Record<string, FlagValue>; errors: { line: number; reason: string }[] };
  export function flagOverrides(e: YouTubeSettings['experiments']): Record<string, FlagValue>;   // known presets, then the text; the text wins
  export function patchFlags(flags: Record<string, unknown>, overrides: Record<string, FlagValue>): boolean;  // mutates; true if anything changed
  export function patchSerialized(serialized: string, overrides: Record<string, FlagValue>): string;
  ```
  `parseFlagOverrides` reads one `name=value` per line:
  - It trims spaces and skips empty lines and lines starting with `#`.
  - Names match `^[A-Za-z0-9_]+$`. `true` and `false` become booleans, finite numbers become numbers, and anything else stays a string.
  - Errors: "Write it as name=value." and "Flag names use letters, digits and underscores."
- Main (`experiments-main.ts`): at `document_start`, it installs the hook Step 1 calls for on the way YouTube creates and fills its config. It keeps every object that carries experiment flags or player configs. When the settings arrive, and on each later config write, it patches them in place with `patchFlags` and `patchSerialized`.

- [ ] **Step 1: Inspect signed out with `page.addInitScript`, and record it in `experiments-main.ts` and the fixture.**
  - **How the config arrives:** how `ytcfg` is created, and every call that writes experiment flags (look for `EXPERIMENT_FLAGS`) or player configs (look for a serialized flags string inside the player context configs). Record the time of each, relative to navigation start, and whether it comes before or after `#movie_player` exists.
  - **The serialized format.**
  - **Late patching:** does a flag changed after the config write, but before the player exists, take effect?
  - **The flags behind the visible test features the design names ("modern player"):** flip candidate flags whose names mention the player's look one at a time, with an init-script override, and compare screenshots of the player controls. Record the flag or flags that switch it, a DOM marker that tells the two player looks apart, and whether a late patch works.
  - **Save the flag list:** save the full list (names and values only, no ids or tokens) as `experiment-flags.json`. Presets are the features found this way. "Block the modern player" is the expected first one.
  - **If a preset only works when set before the first config write,** stop and report NEEDS_CONTEXT with the evidence. The fix (a MAIN-world script registered by the worker) touches `blockingPlan` and needs a ruling.
  - **If no flag switches it signed out,** ship no presets, keep the override box, and say so in the report for the owner.
- [ ] **Step 2: Write the failing `experiments.test.ts`.**
  - `parseFlagOverrides('a=true\nb=false\nc=12\nd=hello\n\n# note\n  e = true  ')` gives the flags `{ a: true, b: false, c: 12, d: 'hello', e: true }` and no errors.
  - `'novalue'` gives the error `{ line: 1, reason: 'Write it as name=value.' }`, and `'bad name!=1'` gives the error "Flag names use letters, digits and underscores."
  - `patchSerialized('a=true&b=1&c=x', { b: 2, d: false })` gives `'a=true&b=2&c=x&d=false'`, and `('', { a: true })` gives `'a=true'`.
  - `patchFlags({ a: true, b: 1 }, { a: false })` is true and sets `a` to false, and `patchFlags({ a: false }, { a: false })` is false.
  - `flagOverrides({ presets: [EXPERIMENT_PRESETS[0].id, 'unknown'], overrides: 'x=1' })` holds the preset's flags plus `x: 1`. If there are no presets, the test uses only the text.
  - Every preset's flag names appear in `experiment-flags.json`.
- [ ] **Step 3: Run, implement, and run again.** Run `pnpm --filter @apps-hub/sieve-core test`. Expected: FAIL, then PASS.
- [ ] **Step 4: Write `experiments.html` and `test/yt/experiments.mjs`, then implement.** `experiments.html` reproduces Step 1's config mechanism, carrying `sieve_test_flag: true` and a serialized `sieve_test_flag=true&other=1`.
  - **Local:** with the overrides `sieve_test_flag=false`, after load the fixture reads `false` and `'sieve_test_flag=false&other=1'`. With `youtube.on` false, both are unchanged.
  - **Live:** with the first preset on, the real page's flag reads the override, and the recorded DOM marker shows the older player. Save `$SHOTS/yt-experiments.png`.
- [ ] **Step 5: Run the checks.** Run `pnpm --filter sieve build && pnpm --filter sieve test:yt -- --only experiments && pnpm --filter sieve test:e2e -- --live`. Expected: PASS.
- [ ] **Step 6: Commit.** Commit with the message `Sieve: YouTube experiments manager`.

### Task 2.15: Keyboard shortcuts

**Files:**
- Create: `apps/sieve/src/commands.ts`, `src/options-shortcuts.ts`, `src/__tests__/commands.test.ts`, `apps/sieve/test/yt/shortcuts.mjs`
- Modify: `apps/sieve/build.mjs` (`manifest.commands = commandsManifest()`, imported by path), `src/background.ts` (`chrome.commands.onCommand.addListener(onCommand)`), `src/options.ts` (append the section), `apps/sieve/package.json` (test list)

**Parallel:** after Tasks 2.1 and 2.3. It shares `options.ts` with Tasks 2.16 and 2.18, so claim it. Shares `background.ts` and `build.mjs`.

**Interfaces:**
- Produces:
  ```ts
  export async function onCommand(command: string, tab?: chrome.tabs.Tab): Promise<void>;
  // 'open-settings' → chrome.runtime.openOptionsPage()
  // 'yt-<action>' → chrome.tabs.sendMessage(tab.id, { type: 'yt-command', action }) with no frameId (each frame applies Task 2.3's frame rule)
  // a missing tab, an unknown command or a tab with no receiver does nothing
  export function shortcutsSection(): HTMLElement;
  ```
- Section copy:
  - The heading "Shortcuts" (`id="shortcuts"`).
  - The text "Chrome lets you set keys for these actions. Sieve sets none, so they never clash with YouTube's keys or a site's."
  - One row per command: its description and its current key from `chrome.commands.getAll()`, or "Not set".
  - The button "Set shortcuts in Chrome", which calls `chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })`.

- [ ] **Step 1: Write the failing `commands.test.ts`** with an in-memory `chrome`.
  - `onCommand('yt-loop', { id: 7 })` sends `(7, { type: 'yt-command', action: 'loop' })`.
  - `onCommand('open-settings')` calls `openOptionsPage`.
  - `onCommand('yt-nope', { id: 7 })` and `onCommand('yt-loop')` send nothing.
  - A rejecting `sendMessage` does not throw.
- [ ] **Step 2: Run, implement, and run again.** Run `pnpm --filter sieve test`. Expected: FAIL, then PASS.
- [ ] **Step 3: Write `test/yt/shortcuts.mjs`.**
  - `dist/manifest.json` has 30 commands, and none has `suggested_key`.
  - `chrome.commands.getAll()` in the worker returns 30 entries, each with `shortcut === ''`.
  - The settings page's Shortcuts section lists 30 rows, each showing "Not set".
  - "Set shortcuts in Chrome" opens a tab at `chrome://extensions/shortcuts`.
  - Binding a real key is on the owner checklist: Chrome has no API to bind one.
- [ ] **Step 4: Implement and run.** Run `pnpm --filter sieve build && pnpm --filter sieve test:yt -- --only shortcuts && pnpm --filter sieve test:e2e`. Expected: PASS, and phase 1's checks still pass.
- [ ] **Step 5: Commit.** Commit with the message `Sieve: keyboard shortcuts`.

### Task 2.16: Settings page: the YouTube section

**Files:**
- Create: `apps/sieve/src/options-youtube.ts`, `apps/sieve/test/yt/settings-page.mjs`
- Modify: `apps/sieve/src/options.ts` (append the section; give every section an `id`; add the side navigation), `src/options.css`

**Parallel:** after Tasks 2.1 and 2.14. It shares `options.ts` with Tasks 2.15 and 2.18, so claim it.

**Interfaces:**
- Produces: `youtubeSection(): HTMLElement` (`id="youtube"`, heading "YouTube"). It renders `YOUTUBE_GROUPS` as sub-headed groups, plus the experiment presets.
  - **YouTube tools switch:** the first control is the "YouTube tools" switch (field `on`). While it is off, every other control in the section stays visible but is greyed out and non-interactive: `inert` on a wrapper around the other controls (as `popup.ts` does for the Blocking stack when Sieve is off) plus 0.5 opacity.
  - **Controls by kind:**
    - switch: a `role="switch"` checkbox, as phase 1 does
    - number: `<input type="number">` with `min`, `max` and `step`, and the unit after it; it saves on `change`, then shows the stored (clamped) value
    - select: `<select>`
    - color: `<input type="color">`
    - text: a `<textarea>` with `maxlength` and a "Save" button
  - **Writing:** each write is `withSettingsLock(async () => set({ youtube: validateYouTube(setPath(current, path, value)) }))`, re-reading `current` inside the lock.
  - **Following other writers:** the section follows `storage.onChanged` for `youtube` and updates each control in place, keeping focus. A textarea the owner has edited is not overwritten.
  - **Experiments:** `EXPERIMENT_PRESETS` show as switches labelled "Block " plus the preset's label. Saving "Flag overrides" shows `parseFlagOverrides` errors as "Line N: reason", and stores the text as typed.
- Side navigation:
  - A `<nav>` with links to every section: Blocking (`#blocking`), Filter lists (`#lists`), My filters (`#my-filters`), Allowlist (`#allowlist`), YouTube (`#youtube`), Shortcuts (`#shortcuts`), Backup and import (`#backup`).
  - It is a sticky left column at widths of 900 px and above, and stacks above the content below that.
  - A link appears only for sections that exist.

- [ ] **Step 1: Write `test/yt/settings-page.mjs` (failing).**
  - **Opening at the section:** `options.html#youtube` opens with the "YouTube" heading's top inside the viewport.
  - **Rendering:** the section has one control per field, 54 of them (the "YouTube tools" switch first), plus one per preset.
  - **YouTube tools switch:** turning it off stores `youtube.on === false`, makes the other controls inert and greyed out, and hides the row in an open fixture tab. Turning it on undoes all three.
  - **Clamping:** "Default speed" 99 then Tab stores 16, and the input shows 16.
  - **Live effect:** "Hide comments" stores `tidy.hideComments === true`, and an open `watch-full` fixture tab hides its comments without a reload.
  - **Two writers:** two settings pages change two different fields at once, and both values land.
  - **Overrides:** saving "Flag overrides" with `a=1\nbad` shows "Line 2: Write it as name=value." and stores the text.
  - **Following other writers:** a change written by the worker updates the matching control while another input keeps focus.
  - **Screenshots:** save `$SHOTS/settings-youtube-light.png` and `-dark.png`.
- [ ] **Step 2: Implement and run.** Run `pnpm --filter sieve build && pnpm --filter sieve test:yt -- --only settings-page && pnpm --filter sieve test:e2e`. Expected: PASS, and phase 1's settings-page checks still pass.
- [ ] **Step 3: Commit.** Commit with the message `Sieve: YouTube settings page`.

### Task 2.17: The menu's YouTube tab

**Files:**
- Create: `apps/sieve/src/popup-youtube.ts`, `apps/sieve/test/yt/menu.mjs`
- Modify: `apps/sieve/src/popup.ts` (adds the tab and picks the starting tab), `src/popup.css`, `src/yt/bridge.ts` (answers the `yt-menu` port), `test/e2e.mjs` (only if a phase 1 check assumed no tab bar)

**Parallel:** after Tasks 2.5, 2.7, 2.8, 2.9 and 2.10. Shares `popup.ts` with no other phase 2 task, and `bridge.ts` with no task running then.

**Interfaces:**
- **Connecting:** the menu connects with `chrome.tabs.connect(tabId, { name: 'yt-menu', frameId: 0 })`.
- **Snapshots:** the top frame answers at once, then on every change (at most every 100 ms) while connected, with:
  ```ts
  { type: 'state'; page: YtPage; state: MainState | null; pressed: Record<string, boolean>; settings: YouTubeSettings }
  ```
  `settings.on` is the YouTube tools switch.
- **Actions:** the menu sends `{ type: 'do', action, value? }`, and the top frame calls `runAction`.
- **No answer:** if the port disconnects at once (not a YouTube page, or no content script), the tab shows the empty state.
- **Starting tab:** the menu opens on "YouTube" when `ytPage(tab.url).kind !== 'other'`, otherwise on "Blocking". The tab bar shows "Blocking" and "YouTube".
- **Copy** (`youtubeView`):
  - the first control is the "YouTube tools" switch, shown from `settings.on` and written the way the settings page writes (`withSettingsLock`, `validateYouTube`). While it is off, every other control in the tab stays visible but is greyed out and non-interactive: `inert` on a wrapper around the other controls (as `popup.ts` does for the Blocking stack when Sieve is off) plus 0.5 opacity.
  - a "Speed" row with "−" (aria-label "Slower"), the value, and "+" (aria-label "Faster")
  - a "Quality" select: "Auto", then each available quality as its height ("1080p")
  - switches: "Loop", "Volume boost", "Cinema mode", "Expand player", "Video filters", "Flip horizontally", "Flip vertically", and "Reverse playlist" (only with a playlist)
  - buttons "Take a screenshot" and "Stop"
  - a footer link "YouTube settings" to `options.html#youtube`
  - empty state: "Open a YouTube video to use these tools."
  - Picture-in-picture is not in the menu, because Chrome needs a click on the page (decision 7).

- [ ] **Step 1: Write `test/yt/menu.mjs` (failing).**
  - **Opening on YouTube:** with a fixture watch tab, `popup.html?tab=<id>` opens on "YouTube" (`aria-selected="true"`), with speed "1×".
  - **Speed:** "Faster" gives the fixture video's rate 1.25 and the menu "1.25×" within 500 ms.
  - **Quality:** the select lists "Auto" and the fake player's levels as heights. Choosing "720p" makes the recorded setter call.
  - **Toggles:** "Loop" gives `video.loop === true`. "Cinema mode" stores `player.cinema === true`.
  - **Screenshot:** "Take a screenshot" makes a download.
  - **YouTube tools switch:** it is the first control. Turning it off stores `youtube.on === false`, makes the other controls inert and greyed out, and hides the fixture's row. The header "Sieve on" switch is unchanged: it is blocking's switch and stays in the header on every tab.
  - **Open question for the owner:** whether the header switch should move into the Blocking tab, labelled "Blocking on", so each tab owns one switch. Until answered, it stays in the header.
  - **Other pages:** a `https://localhost:PORT/ads.html` tab opens on "Blocking", and its "YouTube" tab shows "Open a YouTube video to use these tools."
  - **Phase 1:** the phase 1 menu checks still pass.
  - **Screenshots:** save `$SHOTS/menu-youtube-light.png` and `-dark.png`.
- [ ] **Step 2: Implement and run.** Run `pnpm --filter sieve build && pnpm --filter sieve test:yt -- --only menu && pnpm --filter sieve test:e2e`. Expected: PASS.
- [ ] **Step 3: Commit.** Commit with the message `Sieve: YouTube tab in the menu`.

### Task 2.18: Settings backup and import

**Files:**
- Create: `packages/sieve-core/src/backup.ts`, `src/__tests__/backup.test.ts`
- Create: `apps/sieve/src/options-backup.ts`, `apps/sieve/test/yt/backup.mjs`
- Modify: `apps/sieve/src/options.ts` (append the section), `packages/sieve-core/package.json`

**Parallel:** after Task 2.1. It can run alongside almost everything. It shares `options.ts` with Tasks 2.15 and 2.16, so claim it.

**Interfaces:**
- Produces (core):
  ```ts
  export const BACKUP_MAX_CHARS = 64 * 1024 * 1024;
  export interface Backup { app: 'sieve'; version: 1; exportedAt: string; settings: Settings; youtube: YouTubeSettings }
  export function makeBackup(settings: Settings, youtube: YouTubeSettings, now: Date): Backup;
  export type ReadResult = { ok: true; settings: Settings; youtube: YouTubeSettings } | { ok: false; reason: string };
  export function readBackup(text: string): ReadResult;
  export function backupFileName(now: Date): string;   // local date: 'sieve-settings-2026-11-08.json'
  ```
  The `youtube` part carries `on` (the YouTube tools switch). An older file without it gives `true`.
  `readBackup` checks these in order:
  1. Over `BACKUP_MAX_CHARS`: "This file is too big to be a Sieve backup."
  2. Not JSON: "This file isn't a Sieve backup: it isn't valid JSON."
  3. Not an object, or `app` is not `'sieve'`: "This file isn't a Sieve backup."
  4. A number `version` above 1: "This backup comes from a newer Sieve. Update Sieve, then import it again."
  5. Any other `version` that is not 1: "This file isn't a Sieve backup."
  6. Otherwise `ok`, with `validateSettings(settings)` and `validateYouTube(youtube)` (a missing `youtube` gives the defaults).
- Produces (app): `backupSection(): HTMLElement` (`id="backup"`, heading "Backup and import").
  - The text "Save every Sieve setting, your filters, allowlist and YouTube options in one file."
  - "Save a backup" saves `JSON.stringify(makeBackup(…), null, 2)` through an `<a download>` with `backupFileName(new Date())`. It needs no permission.
  - "Import a backup…" is a file input (`accept=".json,application/json"`).
    - A bad file shows its `reason` (`role="alert"`) and changes nothing.
    - A good file shows "Importing replaces all your Sieve settings, filters and allowlist." with the buttons "Replace my settings" and "Cancel".
  - Replace runs in this order:
    1. `saveMyFilters(backup.settings.blocking.myFilters, stored)` compiles and stores My filters and their rules (rulings R20 and R21 apply). If `notSaved` is set, show "Sieve didn't import anything: " plus its reason, and stop.
    2. Under `withSettingsLock`, re-read `settings` and write, in one `storage.local.set`, `settings` from the backup with the current `blocking.myFilters` kept, and `youtube` from the backup.
    3. Show "Imported your settings." If step 1 listed bad lines, add "N lines in My filters had errors and were skipped." If step 2 throws, show "Sieve imported your filters but not the rest. Import the backup again."

- [ ] **Step 1: Write the failing `backup.test.ts`.**
  - `readBackup(JSON.stringify(makeBackup(s, y, new Date('2026-11-08T10:00:00Z'))))` gives `{ ok: true, settings: s, youtube: y }` for a non-default `s` and `y`.
  - Each of the six reasons above. The newer-version case uses `{ "app": "sieve", "version": 2 }`.
  - `youtube.on: false` round-trips, and a backup whose `youtube` has no `on` reads back `on: true`.
  - A backup whose allowlist holds `{ kind: 'site', host: 'not a host!' }` imports without that entry.
  - `backupFileName(new Date(2026, 10, 8))` gives `'sieve-settings-2026-11-08.json'`.
- [ ] **Step 2: Run, implement, and run again.** Run `pnpm --filter @apps-hub/sieve-core test`. Expected: FAIL, then PASS.
- [ ] **Step 3: Write `test/yt/backup.mjs`.**
  - **Saving:** store the allowlist site `example.com`, My filters `||<TRACKER_HOST>^`, and `youtube.speed.default` 1.5. "Save a backup" then makes a download whose JSON (read in Node) has `app: 'sieve'`, that allowlist, those filters and `youtube.speed.default === 1.5`.
  - **Importing:** clear storage to the defaults, then import that file (`setInputFiles`) and press "Replace my settings". `settings` and `youtube` then deep-equal the backup's, `myRules` is not empty, the dynamic rules include the tracker rule, and the tracker request is blocked again.
  - **Bad files:** a text file shows "This file isn't a Sieve backup: it isn't valid JSON." and storage is unchanged. `{"app":"sieve","version":2}` shows the newer-version message.
- [ ] **Step 4: Implement and run.** Run `pnpm --filter sieve build && pnpm --filter sieve test:yt -- --only backup && pnpm --filter sieve test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit.** Commit with the message `Sieve: settings backup and import`.

### Task 2.19: Phase close: watch-page performance, flicker and leaks, owner checklist

**Files:**
- Create: `apps/sieve/test/yt-perf.mjs`
- Modify: `apps/sieve/README.md`, `apps/sieve/src/manifest.json` (`"version": "0.2.0"`), `docs/handoffs/sieve.md`

**Parallel:** last. Run it with exclusive use of the machine (claim `apps/sieve`, and run nothing else), as Task 1.13 did.

- [ ] **Step 1: Write `yt-perf.mjs`.** Reuse `perf.mjs`'s launch and timing helpers (import them if it exports them, else copy those few lines). It has three parts:
  - **Leaks (local fixture):**
    - Store every YouTube option on: every switch true, every select at a non-default value, and the filters on.
    - Run 25 `__navigate` cycles. After `HeapProfiler.collectGarbage`, read `Performance.getMetrics` at navigations 5 and 25.
    - Pass when `JSEventListeners` grew by at most 5, `Nodes` by at most 20 and `JSHeapUsedSize` by at most 1 MB.
  - **Settings read cost (local fixture):** the `sieve-yt-applied` mark time with 2 MB of My filters text stored, against none: the median over 10 loads each. Pass when it is at most 20 ms later.
  - **Watch-page load (live, signed out):** `https://www.youtube.com/watch?v=dQw4w9WgXcQ`, 7 cold loads with Sieve and 7 without, alternating, once with the default options and once with every option on.
    - Report the median DCL, load time and `JSHeapUsedSize` 10 s after load.
    - Pass when the median load with Sieve is at most 1.10× without, and the heap difference is at most 5 MB, in both passes.
    - A bot-check side is reported as excluded, not passed (ruling R23).
- [ ] **Step 2: Run the full phase gate.** Run `pnpm test && pnpm typecheck && pnpm --filter sieve build && pnpm --filter sieve test:e2e && pnpm --filter sieve test:yt && pnpm --filter sieve test:e2e -- --live && node apps/sieve/test/perf.mjs && node apps/sieve/test/yt-perf.mjs`. Expected: everything passes, including Task 2.4's live flicker check and Task 2.3's first-paint check. Paste the perf tables into the handoff.
- [ ] **Step 3: Review.** Run the `code-reviewer` and `requirements-verifier` agents on the phase 2 diff against design goal 2, the Screens section and this plan, and fix what they confirm.
- [ ] **Step 4: Write the README's YouTube section.** It covers:
  - what each tool does
  - where the settings live (the `youtube` key)
  - what YouTube can see (`MainSettings` in page events)
  - the new `downloads` permission (screenshots, saved in the `Sieve` folder inside Downloads)
  - the 30 shortcuts with no default keys
  - known limits gathered from each task's report, including: forcing H.264 can leave a video with no H.264 version unplayable; PiP needs a click on the page; reversed playlists reverse only the automatic advance
  - the owner's signed-in checklist:
    1. With your account, the row appears under the player, and Speed, Loop, Boost volume, Cinema, Expand, Filters, Flip and Screenshot (saved in Downloads/Sieve) work. After 5 clicks on related videos the row never blinks.
    2. With Premium, picking 1080p causes no error and the row is unaffected.
    3. A members-only video you can watch, and an age-restricted video, play as before, with no errors in the console from Sieve.
    4. With "Boost volume" on, open a video in a new tab without clicking: it plays with sound. Click the page: the boost starts.
    5. With "Play H.264 only", "Stats for nerds" shows `avc1`. With "Play at most 30 frames per second", it shows 30 fps or fewer.
    6. Picture-in-picture from its button in the row.
    7. Bind one shortcut in `chrome://extensions/shortcuts` and use it on a video.
    8. Save a backup, change a setting, import the backup: the setting is back.
    9. Turn "YouTube tools" off: the row disappears and the shortcuts stop. The header "Sieve on" (blocking) is unaffected.
    10. With your real Enhancer settings re-entered in Sieve, uninstall Enhancer and use YouTube for a day.
- [ ] **Step 5: Update the handoff and commit.** Update the session log, the current state and the next step ("plan phase 3"). Commit with the message `Sieve: phase 2 checks and hand-off`.

---

## Decisions I made

Each is a choice the design leaves open, with why and what it costs if wrong.

1. **YouTube settings live in their own storage key, `youtube`, not inside `settings`.**
   - Why: the worker re-applies blocking and drops its cosmetic cache on every `settings` change (`background.ts`). A speed or cinema toggle would cost a blocking re-apply and a 4 MB map reload, and would rewrite My filters' text (megabytes) with each press.
   - Cost if wrong: the backup carries two parts (Task 2.18), and the lock covers one more key.
2. **Sieve has three tools (Blocking, YouTube tools and Downloads), each with its own independent switch.**
   - The menu header's "Sieve on" switch (`settings.enabled`) keeps meaning blocking only, as in phase 1.
   - The YouTube tools switch is `youtube.on` (default on, so installing phase 2 still changes only the row). The bridge's `on` comes from it, never from `settings.enabled`.
   - Phase 3 adds a Downloads switch the same way (`downloads.on`).
   - "Pause everywhere" and the allowlist are blocking words and do not affect the YouTube tools.
   - Why: the owner asked for a separate switch for each Sieve tool (Question 3).
   - Cost if wrong: one field in `YouTubeSettings` and the places that read `on`: `bridge.ts`, the settings page and the menu's YouTube tab.
3. **Every YouTube option starts at YouTube's own behaviour,** except the harmless speed wheel over the row's speed value.
   - Why: installing phase 2 then changes nothing surprising (anti-goals 2 and 4).
   - Cost if wrong: the owner re-enters their Enhancer choices once. (Question 1.)
4. **Settings reach the page asynchronously:** one storage read at `document_start`, plus a hello handshake with the main world. There is no `userScripts` permission.
   - Why: no extra permission or Chrome toggle, and YouTube creates its player long after a few-millisecond storage read. Task 2.3's live first-paint check tests this.
   - Cost if wrong: on a hard load, a hidden element could flash, or the first video could start before the speed or quality applies. The fallback is `chrome.userScripts` (settings baked into a registered script, synchronous). That needs the owner to turn on "Allow user scripts" for Sieve, so it waits for the owner's go.
5. **Per-video state is not stored** (the loop and its part, flips, the current speed). Stored toggles are boost, cinema, expand and the filters.
   - Why: it matches how a loop or a flip is used. Stored toggles cost a storage write and a broadcast to every YouTube tab.
   - Cost if wrong: a flip resets on the next video.
6. **Loop, Filters and Flip are split buttons.** The main part toggles, and a narrow arrow opens the options.
   - Why: one click for the common action, with the part loop, the sliders and vertical flip still within reach.
   - Cost if wrong: a CSS and markup change in `row.ts`.
7. **The cog opens a short menu:** Stop, Reverse playlist (only with a playlist) and Sieve settings. Picture-in-picture has its own button in the row.
   - Why: Chrome opens picture-in-picture only from a click on the page (a shortcut or the toolbar menu does not count; Task 2.9 confirms), and a row button is such a click. Stop and Reverse playlist are not in the chosen row.
   - Cost if wrong: the row is one button wider, or one cog item longer. (Question 4.)
8. **The wheel.**
   - Speed: over the row's speed value, or over the video while holding the right button.
   - Volume: over the video, or over the video while holding the right button.
   - Both cannot use the right button. "Reverse the wheel" covers both.
   - Why: plain wheel over the video for both would clash, and the design ties the right-button option to volume.
   - Cost if wrong: a select's options in `youtube-settings.ts`.
9. **Reversed playlists reverse only the automatic advance,** not the panel's order or YouTube's Next button.
   - Why: reordering YouTube's panel means rewriting its list, and that breaks with its markup.
   - Cost if wrong: Next still goes forward.
10. **Screenshots go to a `Sieve` subfolder of Downloads as `<title> <time>.png` through `chrome.downloads`** (final path `Downloads/Sieve/<title> <time>.png`, the `chrome.downloads` filename `Sieve/<title> <time>.png`), which adds the `downloads` permission now (phase 3 needs it anyway). They include the flips and filters on screen.
    - Why: a click-free download that also works from a shortcut, and a picture that matches what the owner sees.
    - Cost if wrong: one permission earlier than planned. (Question 5.)
11. **The menu opens on the YouTube tab on YouTube pages,** the design's unconfirmed guess.
    - Cost if wrong: the channel's "Allow ads on…" switch is one click further away (it stays on the Blocking tab).
12. **No row in embeds, live chat or the Shorts player.** Embeds get speed, quality (their own context), volume, the codec limits, the wheel and shortcuts. Live chat gets the theme.
    - Why: an embed has no "under the player" space, and Shorts have their own player.
    - Cost if wrong: one more mount target in `row.ts`.
13. **The accent palette is 12 colours plus YouTube red,** as data in core. It is page content Sieve applies to YouTube, not Sieve's UI, so it is a stated exception to the tokens rule.
    - Cost if wrong: one list.
14. **The backup holds `settings` and `youtube` only.** My filters' compiled data is rebuilt on import by the same `saveMyFilters` path. Counts, build data and the session are not backed up.
    - Cost if wrong: a field added to the format later.
15. **The experiments manager has presets found by inspection, plus a free-form "Flag overrides" box.**
    - Why: YouTube renames flags, and the box lets the owner fix that without a rebuild.
    - Cost if wrong: one textarea. (Question 2.)
16. **Shorts conversion happens in the page** (link clicks, direct loads and in-app navigations), not with network rules. That keeps phase 2 out of the blocking plan.
    - Cost if wrong: a direct Shorts load spends one extra page request before it redirects.
17. **There is one shortcut per action,** including one per quality and one for opening settings, with no default keys. The worker routes them to the active tab.
    - Cost if wrong: entries in a list.
18. **Content scripts write settings through the worker.** A content script's Web Lock belongs to youtube.com, so it cannot share the extension's settings lock (R20).
    - Cost if wrong: about a 100 ms wake-up of the worker on a stored toggle.
19. **The README and the handoff are updated once at phase close (Task 2.19), not per task,** so parallel tasks do not queue on them. Each task reports its limits in its hand-back.
    - Cost if wrong: a limit is lost if a hand-back omits it. The controller copies them to the ledger as they land.

## Questions for the owner

Questions 1 to 5 were answered 2026-11-10, and the plan above is amended to match. Question 6 is open.

1. **Which Enhancer options do you use today?** For example: default speed, quality, theme and accent, hidden Shorts or comments, autoplay. With your list, those become Sieve's defaults instead of "off".
   - Answer (2026-11-10): defaults (reading). The owner sent no list, so every option starts at YouTube's own behaviour, as written.
2. **Which YouTube test features do you want blocked?** The design names the "modern player". A signed-out test profile sees only the experiments YouTube gives a fresh profile, so tell me any you see signed in.
   - Answer (2026-11-10): defaults (reading). The owner sent no list, so the presets are what inspection finds signed out, all off, plus the free-form "Flag overrides" box.
3. **Should the menu's "Sieve on" switch also turn off the YouTube tools,** or only blocking?
   - Answer (2026-11-10): "separate switch for each Sieve tool". The main session's reading: Blocking, YouTube tools and Downloads each get an independent switch, and the header switch keeps meaning blocking (Decision 2).
4. **Picture-in-picture:** is it fine in the cog menu under the video, or do you want its own button in the row? Chrome only opens it from a click on the page.
   - Answer (2026-11-10): its own button in the row, not in the cog menu (Decision 7).
5. **Screenshots:** Downloads folder root or a "YouTube screenshots" subfolder? And with your filters and flips applied, or the raw frame?
   - Answer (2026-11-10): a Downloads subfolder, with filters and flips applied (Decision 10). The owner did not name the subfolder: `Sieve` is the main session's reading.
6. **Should the header "Sieve on" switch move into the Blocking tab, labelled "Blocking on",** so each tab owns one switch? Until answered, it stays in the header on every tab (Task 2.17).
   - Answer: not yet answered.

## Scheduling

"Shared files" are files more than one phase 2 task modifies. Claim them through coord in alphabetical order and commit by pathspec (ruling R22). `packages/sieve-core/package.json` (the test list) is shared by every task with a core part, and `apps/sieve/package.json` by every task with an app unit test. Neither is repeated in the table.

| Task | Title | Depends on | Can run alongside | Shared files it modifies |
|---|---|---|---|---|
| 2.1 | Settings, actions, field list (core) | phase 1 | 2.2 | `sieve-core/src/settings.ts` (export only) |
| 2.2 | Page facts, selectors, fixtures | phase 1 | 2.1 | `test/harness.mjs`, `test/yt-live.mjs` |
| 2.3 | Settings at `document_start`, bridge | 2.1, 2.2 | none | `yt-relay.ts`, `yt-main.ts`, `background.ts` |
| 2.4 | Button row | 2.3 | 2.7, 2.11–2.14, 2.18 | `yt-relay.ts` |
| 2.5 | Speed | 2.4 | 2.7–2.14 | `yt-relay.ts`, `yt-main.ts` |
| 2.6 | Volume, booster, wheel | 2.5 | 2.7–2.14 | `yt-relay.ts`, `yt-main.ts` |
| 2.7 | Quality, H.264, 30 fps | 2.3 | 2.4–2.6, 2.8–2.14 | `yt-main.ts` |
| 2.8 | Loop, stop, reversed playlist | 2.4 | 2.5–2.7, 2.9–2.14 | `yt-relay.ts`, `yt-main.ts` |
| 2.9 | Screenshot, PiP | 2.4 | 2.5–2.8, 2.10, 2.12–2.14 (not 2.11) | `yt-relay.ts`, `yt-handler.ts`, `__tests__/yt-handler.test.ts`, `manifest.json` |
| 2.10 | Cinema, expand, theater, flip, filters | 2.4 | 2.5–2.9, 2.11–2.14 | `yt-relay.ts` |
| 2.11 | Autoplay rules | 2.3 | 2.4–2.8, 2.10, 2.12–2.14 (not 2.9) | `yt-relay.ts`, `yt-handler.ts`, `__tests__/yt-handler.test.ts` |
| 2.12 | Page tidying | 2.3 | 2.4–2.11, 2.13, 2.14 | `yt-relay.ts` |
| 2.13 | Theme and my CSS | 2.3 | 2.4–2.12, 2.14 | `yt-relay.ts` |
| 2.14 | Experiments manager | 2.3 | 2.4–2.13 | `yt-main.ts` |
| 2.15 | Keyboard shortcuts | 2.1, 2.3 | 2.4–2.14 | `options.ts`, `background.ts`, `build.mjs` |
| 2.16 | Settings page, YouTube section | 2.1, 2.14 | 2.17 | `options.ts`, `options.css` |
| 2.17 | Menu's YouTube tab | 2.5, 2.7–2.10 | 2.16, 2.18 | `popup.ts`, `popup.css`, `yt/bridge.ts`, `test/e2e.mjs` |
| 2.18 | Backup and import | 2.1 | 2.2–2.17 | `options.ts` |
| 2.19 | Phase close | all | none (exclusive) | `README.md`, `manifest.json`, `docs/handoffs/sieve.md` |

`yt-relay.ts` and `yt-main.ts` edits are one import line per task. Conflicts there are trivial, but claims still apply. `options.ts` edits are one append line per section, except Task 2.16, which also adds section ids and the navigation: run 2.16 before 2.15 and 2.18 commit, or claim the file.

## Out of scope

- The design's non-goals: Image Swap, the custom JavaScript runner, and the pop-up and mini players.
- The row's Download button and YouTube downloads (phase 5). `ROW_ORDER` already places `download` before the cog.
- `m.youtube.com` and `music.youtube.com`: they keep Task 1.11's ad removal only.
- Picking items inside iframes with the element picker (deferred from Task 1.8). It is a blocking feature, not a YouTube one: plan it as a phase 1 follow-up when the owner wants it.
