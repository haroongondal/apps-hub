import { wheelSteps, type WheelState } from '@apps-hub/sieve-core/src/playback.ts';
import { runAction } from './actions.ts';
import { feature, onMainState, onNavigate, onSettings, toMain } from './bridge.ts';
import { toast } from './row.ts';
import { SEL } from './selectors.ts';

feature('wheel', () => {
  let tools = false;
  let speedMode = 'over-speed';
  let volumeMode = 'off';
  let reverse = false;
  let held: MouseEvent | null = null; // the right button's press, while it is down
  let withheld = false; // macOS and Linux send the contextmenu at the press, before any wheel: it is kept back until the release shows whether the wheel was used
  let silence = false; // a wheel step used the button, so a contextmenu at the release (Windows) is not wanted
  let announce = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tries = 0;
  const wheel: WheelState = { acc: 0, at: 0 };
  const wired = new WeakSet<Element>();

  function onWheel(e: WheelEvent): void {
    if (!e.isTrusted || !tools || e.ctrlKey) return; // ctrl + wheel is the browser's zoom
    const speed = held !== null && speedMode === 'right-button';
    const volume = !speed && (held ? volumeMode === 'right-button' : volumeMode === 'over-video');
    if (!speed && !volume) return;
    e.preventDefault();
    if (held) silence = true;
    const step = wheelSteps(wheel, e.deltaY, e.deltaMode, performance.now(), reverse);
    if (!step) return;
    if (speed) void runAction(step > 0 ? 'speed-up' : 'speed-down');
    else {
      announce = Date.now() + 1000;
      toMain({ action: 'volume-step', value: step });
    }
  }

  function attach(): void {
    clearTimeout(timer);
    timer = undefined;
    const player = document.querySelector(SEL.player);
    if (!player) {
      // A hard-loaded page may not have its player yet; the navigation event usually comes first.
      if (tries++ < 40) timer = setTimeout(attach, 250);
      return;
    }
    if (wired.has(player)) return;
    wired.add(player);
    player.addEventListener('wheel', (e) => onWheel(e as WheelEvent), { passive: false });
    player.addEventListener('mousedown', (e) => {
      if (e.isTrusted && (e as MouseEvent).button === 2) {
        held = e as MouseEvent;
        silence = withheld = false;
      }
    });
  }

  // Released outside the player, or in another window: either way the gesture is over.
  window.addEventListener('mouseup', (e) => {
    if (!e.isTrusted || e.button !== 2 || !held) return;
    const press = held;
    held = null;
    // No wheel step: it was a plain right click, so the page's menu comes now, from a copy of the event it never got.
    if (withheld && !silence) press.target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, view: window, button: 2, clientX: press.clientX, clientY: press.clientY }));
    withheld = false;
    if (silence) setTimeout(() => (silence = false), 100); // the release's own contextmenu (Windows) follows at once; none may eat a later one
  }, true);
  window.addEventListener('blur', () => (held = null));
  document.addEventListener('contextmenu', (e) => {
    const keep = held !== null && !silence && (speedMode === 'right-button' || volumeMode === 'right-button') && tools;
    if (!e.isTrusted || !(keep || silence)) return;
    if (keep) withheld = true;
    silence = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  onSettings((y, on) => {
    tools = on;
    speedMode = y.speed.wheel;
    volumeMode = y.volume.wheel;
    reverse = y.reverseWheel;
    tries = 0;
    attach();
  });
  onNavigate(() => {
    tries = 0;
    attach();
  });
  onMainState((s) => {
    if (announce > Date.now()) {
      announce = 0;
      toast(`Volume ${s.volume}%`);
    }
  });
});
