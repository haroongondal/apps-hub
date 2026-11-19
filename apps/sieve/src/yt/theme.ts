import { ACCENTS } from '@apps-hub/sieve-core/src/youtube-settings.ts';
import { feature, onSettings, setStyle } from './bridge.ts';
import { DARK_ATTR } from './selectors.ts';
import ACCENT_CSS from './theme.css';

// Dark theme. inspected 2026-11-10, signed out, Chrome for Testing 149.0.7827.55, no extension:
// - A bare `dark` attribute on <html> is all YouTube's dark theme needs (DARK_ATTR in selectors.ts): with it added by an init script at the very start
//   of a light profile, <html> and ytd-app turned rgb(15, 15, 15) (rgb(255, 255, 255) without it), and YouTube itself then gave ytd-masthead its own `dark`
//   attribute. Through the whole page load (about 5 s of attribute observation on <html>, from before the first script), YouTube never removed or changed `dark`, so there is
//   no attribute observer here. shortcut: if YouTube starts removing it, put an observer on <html> that sets it again.
//   A second run with the extension and "Dark theme" on (Chrome for Testing 149.0.7827.55, same day) saw `dark` set once, at 518 ms, and never touched through three in-app
//   navigations and back. YouTube's own Appearance setting could not be tried: the signed-out Settings menu in this browser has no Appearance item (it lists data, language,
//   Restricted Mode, location, shortcuts, Settings, Help, feedback), so whether YouTube removes `dark` when Appearance is switched to Light is unchecked (Task 2.19).
// - The element whose background the live check reads is ytd-app: rgb(255, 255, 255) light, rgb(15, 15, 15) dark (<html> has the same two values).
// - A live chat frame: not inspectable here. Signed out and headless, www.youtube.com/live_chat showed "It looks like you're using an older version of your
//   browser" (one inline style, no <html> attributes and no YouTube stylesheet or script). With `dark` added at its start the attribute stayed, and
//   the main page's own stylesheets hold `html[dark]` rules for the chat's variables (--yt-live-chat-background-color and --yt-live-chat-primary-text-color).
//   The same code runs in a chat frame (ytPage gives it the kind 'chat'); the real chat's look is unchecked.
//
// Accent. inspected the same day, signed out, dQw4w9WgXcQ in a light and a dark profile, and a live stream's page (the live badge):
// - Progress bar: `.ytp-play-progress { background: linear-gradient(90deg, rgb(255, 0, 51) 80%, rgb(255, 39, 145)) }`, a hard-coded gradient with a
//   transparent background-color, so it needs its own rule. It also carries `.ytp-swatch-background-color`. `.ad-interrupting` and `.ypc-loaded`
//   rules (specificity 0,3,0) set yellow and blue on it; the accent rule is 0,1,1, so those still win.
// - Scrubber: `.ytp-swatch-background-color { background-color: var(--yt-sys-color-baseline--static-brand-red, #f03) }`, computed rgb(255, 0, 51).
// - Live badge: `.ytp-livebadge-color .ytp-live-badge.ytp-live-badge-is-livehead::before` uses var(--yt-sys-color-baseline--overlay-background-brand, rgba(225, 0, 45, 0.9)),
//   as do the red "live" badges on thumbnails (badge-shape.ytBadgeShapeThumbnailLive, the same rgba(225, 0, 45, 0.9)). `.ytp-progress-linear-live-buffer` is rgb(204, 0, 0), 80% of the red, so the accent gets 80% of itself (color-mix with black).
// - Both variables are defined as `[light], html`, `html[color-version="v2_0"]` and `html[color-version="v2_0"][dark]` rules, `#f03` and rgba(225,0,45,0.9) in each,
//   so the accent sets them with `:root:root:root`, which outranks all three.
// - Subscribe button: signed out it is a black pill with white text (white with black text in dark theme), not red. A scan of the signed-out watch page's visible
//   elements for red found only the logo, the bars, the live badges and a faint red touch-feedback tint, so the accent leaves the button and the logo alone.
// The same items in a chat frame: not inspectable (see above).

feature('theme', () => {
  let added = false;
  onSettings((y, on) => {
    const root = document.documentElement;
    const dark = on && y.theme.dark;
    if (dark && !root.hasAttribute(DARK_ATTR)) {
      root.setAttribute(DARK_ATTR, '');
      added = true;
    } else if (!dark && added) {
      root.removeAttribute(DARK_ATTR);
      added = false;
    }
    // Both styles are made on the first call even when empty, so the accent always comes before my CSS in the page, and a later accent does not outrank it.
    const hex = ACCENTS.find((a) => a.key === y.theme.accent)?.hex;
    setStyle('accent', on && hex ? `${ACCENT_CSS}\n:root { --sieve-accent: ${hex}; }` : '');
    setStyle('my-css', on ? y.theme.css : '');
  });
});
