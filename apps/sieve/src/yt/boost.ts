import { defineAction } from './actions.ts';
import { feature, onNavigate, onSettings, saveYouTube } from './bridge.ts';
import { addButton, refreshRow, toast, type RowButton } from './row.ts';
import { SEL } from './selectors.ts';

const CANT = "Sieve can't boost this video.";
const MARK = 'sieve-boost';

// No AudioContext before a click or key press (an autoplaying video must never be silenced); one source node per video element, only for a blob: source
// and only once the context runs. A source node cannot be undone, so Off sets the gain to 1.
feature('boost', () => {
  let on = false; // youtube.on and volume.boostOn
  let times = 2;
  let asked = 0; // when the owner last switched boost on: a video that cannot be boosted says so then, not on every page load
  let armed = false;
  let ctx: AudioContext | null = null;
  let gain: GainNode | null = null;
  let chain = Promise.resolve();
  const sources = new WeakMap<HTMLVideoElement, MediaElementAudioSourceNode>();
  const video = (): HTMLVideoElement | null => document.querySelector<HTMLVideoElement>(SEL.video);
  const cant = (): void => {
    if (asked > Date.now()) toast(CANT);
  };

  function disarm(): void {
    armed = false;
    document.removeEventListener('pointerdown', activated, true);
    document.removeEventListener('keydown', activated, true);
  }

  function activated(e: Event): void {
    if (!e.isTrusted) return;
    disarm();
    setTimeout(schedule, 0); // an Escape key press carries no activation, so route() arms again
  }

  function arm(): void {
    if (armed) return;
    armed = true;
    document.addEventListener('pointerdown', activated, true);
    document.addEventListener('keydown', activated, true);
  }

  async function route(): Promise<void> {
    const v = video();
    if (!on) {
      if (gain) gain.gain.value = 1;
      v?.removeAttribute(MARK);
      return;
    }
    if (!v) return;
    if (!navigator.userActivation.hasBeenActive) return arm();
    if (!v.src.startsWith('blob:')) return cant();
    ctx ??= new AudioContext();
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    if (ctx.state !== 'running') return arm();
    if (!gain) {
      gain = ctx.createGain();
      gain.connect(ctx.destination);
      const c = ctx;
      c.addEventListener('statechange', () => {
        if (c.state === 'suspended') c.resume().catch(() => {});
      });
    }
    if (!sources.has(v)) {
      try {
        const source = ctx.createMediaElementSource(v);
        source.connect(gain);
        sources.set(v, source);
      } catch {
        return cant();
      }
    }
    gain.gain.value = times;
    v.setAttribute(MARK, 'running');
  }

  function schedule(): void {
    chain = chain.then(route).catch((e) => console.error('Sieve could not boost the volume', e));
  }

  async function toggle(): Promise<void> {
    if (!on) asked = Date.now() + 2000;
    const result = await saveYouTube({ volume: { boostOn: !on } });
    if (!result.ok) toast(result.message ?? CANT);
  }

  const button: RowButton = { id: 'boost', label: 'Boost volume', title: 'Boost volume ×2', pressed: () => on, onClick: () => void toggle() };
  defineAction('boost', toggle, () => on);
  addButton(button);
  onSettings((y, isOn) => {
    on = isOn && y.volume.boostOn;
    times = y.volume.boost;
    button.title = `Boost volume ×${times}`;
    refreshRow();
    schedule();
  });
  onNavigate(schedule);
  document.addEventListener('loadstart', (e) => {
    if (on && e.target === video()) schedule();
  }, true);
});
