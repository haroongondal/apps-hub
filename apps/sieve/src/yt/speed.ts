import { formatSpeed, wheelSteps, type WheelState } from '@apps-hub/sieve-core/src/playback.ts';
import { defineAction } from './actions.ts';
import { feature, mainState, onMainState, onSettings, toMain } from './bridge.ts';
import { addButton, refreshRow, rowElement, toast } from './row.ts';

const rate = (): number => mainState()?.rate ?? 1;
// A shortcut or the menu runs an action: the next main state shows the speed in the row. A row click shows it on the button instead.
let announce = 0;
const ask = (action: string, value?: number): void => toMain(value === undefined ? { action } : { action, value });
const announced = (action: string, value?: number) => (): void => {
  announce = Date.now() + 1000;
  ask(action, value);
};

defineAction('speed-down', announced('speed-step', -1));
defineAction('speed-up', announced('speed-step', 1));
defineAction('speed-default', announced('speed-default'));
defineAction('speed-normal', announced('speed-normal'));

feature('speed', () => {
  let tools = false;
  let wheelMode = 'over-speed';
  let reverse = false;
  const wheel: WheelState = { acc: 0, at: 0 };

  addButton({ id: 'speed-down', label: '−', ariaLabel: 'Slower', onClick: () => ask('speed-step', -1) });
  addButton({
    id: 'speed',
    label: () => formatSpeed(rate()),
    ariaLabel: () => `Speed ${formatSpeed(rate())}. Click for your default speed.`,
    onClick: () => ask('speed-default'),
  });
  addButton({ id: 'speed-up', label: '+', ariaLabel: 'Faster', onClick: () => ask('speed-step', 1) });

  rowElement('speed')?.addEventListener(
    'wheel',
    (e) => {
      if (!e.isTrusted || !tools || wheelMode !== 'over-speed') return;
      e.preventDefault();
      const step = wheelSteps(wheel, e.deltaY, e.deltaMode, performance.now(), reverse);
      if (step) ask('speed-step', step);
    },
    { passive: false },
  );
  onSettings((y, on) => {
    tools = on;
    wheelMode = y.speed.wheel;
    reverse = y.reverseWheel;
  });
  onMainState((s) => {
    refreshRow();
    if (announce > Date.now()) {
      announce = 0;
      toast(`Speed ${formatSpeed(s.rate)}`);
    }
  });
});
