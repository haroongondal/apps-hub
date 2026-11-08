import { validateSettings, type FeatureKey, type Settings } from '@apps-hub/sieve-core/src/settings.ts';
import { h } from './dom.ts';
import { withSettingsLock } from './lock.ts';

export { NAMES } from './lists.ts';

// Resolves false (and logs) on failure, so a switch can flip back and no caller leaves a rejection unhandled.
export const save = (edit: (s: Settings) => Settings): Promise<boolean> =>
  withSettingsLock(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: edit(validateSettings(settings)) });
  }).then(
    () => true,
    (e) => {
      console.error('Sieve could not save the settings', e);
      return false;
    },
  );
export const setBlocking = (patch: Partial<Settings['blocking']>) => save((s) => ({ ...s, blocking: { ...s.blocking, ...patch } }));
export const setList = (f: FeatureKey, on: boolean) => save((s) => ({ ...s, blocking: { ...s.blocking, lists: { ...s.blocking.lists, [f]: on } } }));

export function toggle(text: string, on: boolean, change: (on: boolean) => Promise<boolean>, props: Record<string, unknown> = {}): HTMLLabelElement {
  const input: HTMLInputElement = h('input', {
    type: 'checkbox',
    role: 'switch',
    checked: on,
    ...props,
    onchange: async () => {
      const want = input.checked;
      if (!(await change(want)) && input.checked === want) input.checked = !want;
    },
  });
  return h('label', { class: 'switch' }, h('span', {}, text), input);
}

export const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

// Only Chrome's static rule limits are fixed by turning a list off; any other refusal gets general advice.
const RULE_LIMIT = /enabled rulesets exceeds the (?:regular expression )?rule count limit/i;

export function errorText(message: string): string {
  const said = /[.!?]$/.test(message) ? message : `${message}.`;
  return `${said} ${RULE_LIMIT.test(message) ? 'Turn a list off in Settings to make room.' : 'Open Settings and check My filters, or reload Sieve from chrome://extensions.'}`;
}
