import { formatTime, loopSeek, parseTime, type LoopPart } from '@apps-hub/sieve-core/src/time.ts';
import { h } from '../dom.ts';
import SWITCH_CSS from '../switch.css';
import { defineAction, notifyActions, runAction } from './actions.ts';
import { feature, mainState, onMainState, onNavigate, onSettings } from './bridge.ts';
import { addButton, addMenuItem, refreshRow } from './row.ts';
import { SEL } from './selectors.ts';

const BAD_TIME = 'Enter a time like 1:05 or 75.';
const CSS = `${SWITCH_CSS}
.range { display: grid; grid-template-columns: 1fr auto; align-items: end; gap: var(--space-xs); }
.range .ui-meta { grid-column: 1 / -1; margin: 0; }`;

const real = <E extends Event>(fn: (e: E) => void) => (e: E) => {
  if (e.isTrusted) fn(e);
};

feature('loop', () => {
  let part: LoopPart | null = null;
  let texts = { from: '', to: '' };
  let videoId: string | null = null;
  let on = false;
  const wired = new WeakSet<HTMLVideoElement>();

  function video(): HTMLVideoElement | null {
    const v = document.querySelector<HTMLVideoElement>(SEL.video);
    if (v && !wired.has(v)) {
      wired.add(v);
      v.addEventListener('timeupdate', () => {
        const ad = document.querySelector(SEL.player)?.classList.contains('ad-showing');
        const to = v.loop && !ad ? loopSeek(v.currentTime, part, v.duration) : null;
        if (to !== null) v.currentTime = to;
      });
    }
    return v;
  }

  function setPart(): void {
    const start = texts.from === '' ? 0 : parseTime(texts.from) ?? 0;
    const end = texts.to === '' ? Infinity : parseTime(texts.to) ?? Infinity;
    part = texts.from === '' && texts.to === '' ? null : { start, end };
    video();
  }

  function reset(): void {
    const v = video();
    if (v) v.loop = false;
    part = null;
    texts = { from: '', to: '' };
    notifyActions();
  }

  function setLoop(value: boolean): void {
    const v = video();
    if (v) v.loop = value;
    notifyActions();
  }

  function field(key: 'from' | 'to', label: string, placeholder: string): { el: HTMLElement; clear: () => void } {
    const error = h('p', { class: 'ui-meta', role: 'alert', hidden: true }, BAD_TIME);
    const input = h('input', { class: 'ui-input', type: 'text', autocomplete: 'off', placeholder, value: texts[key], 'aria-label': label });
    const show = (bad: boolean): void => {
      error.hidden = !bad;
      input.setAttribute('aria-invalid', String(bad));
    };
    const commit = (): void => {
      const text = input.value.trim();
      const bad = text !== '' && parseTime(text) === null;
      show(bad);
      if (bad) return;
      texts[key] = text;
      setPart();
    };
    input.addEventListener('change', real(commit));
    const now = h('button', { type: 'button', class: 'ui-btn', onclick: real(() => { input.value = formatTime(video()?.currentTime ?? 0); commit(); }) }, 'Now');
    const el = h('div', { class: 'range', role: 'group', 'aria-label': label }, h('span', { class: 'ui-meta', 'aria-hidden': 'true' }, label), input, now, error);
    return { el, clear: () => { input.value = ''; show(false); } };
  }

  function build(): HTMLElement {
    const v = video();
    const toggle: HTMLInputElement = h('input', { type: 'checkbox', role: 'switch', checked: v?.loop === true, onchange: real(() => setLoop(toggle.checked)) });
    const from = field('from', 'From', '0:00');
    const to = field('to', 'To', v && Number.isFinite(v.duration) ? formatTime(v.duration) : '');
    const clear = h('button', { type: 'button', class: 'ui-btn ui-btn--ghost', onclick: real(() => {
      texts = { from: '', to: '' };
      setPart();
      from.clear();
      to.clear();
    }) }, 'Clear');
    return h('div', { class: 'loop-options' }, h('style', {}, CSS), h('label', { class: 'switch' }, h('span', {}, 'Loop this video'), toggle), from.el, to.el, clear);
  }

  defineAction('loop', () => setLoop(video()?.loop !== true), () => video()?.loop === true);
  addButton({ id: 'loop', label: 'Loop', pressed: () => video()?.loop === true, onClick: () => void runAction('loop'), menu: { label: 'Loop options', build } });
  addMenuItem({ id: 'stop', label: 'Stop', onClick: () => void runAction('stop') });
  addMenuItem({
    id: 'reverse-playlist',
    label: 'Reverse playlist',
    onClick: () => void runAction('reverse-playlist'),
    visible: () => mainState()?.playlist != null,
    checked: () => mainState()?.playlist?.reversed === true,
  });

  onMainState(() => refreshRow());
  onSettings((_y, isOn) => {
    if (on && !isOn) reset();
    on = isOn;
  });
  onNavigate((p) => {
    if (p.videoId === videoId) return;
    videoId = p.videoId;
    reset();
  });
});
