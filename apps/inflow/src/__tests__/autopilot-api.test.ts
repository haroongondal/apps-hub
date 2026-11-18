import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { InflowCoreApi, AutopilotSettings, PickableChat } from '../../modules/inflow-core/src/index.ts';

const moduleDir = join(import.meta.dirname, '../../modules/inflow-core');
const kotlin = (path: string) => readFileSync(join(moduleDir, 'android/src/main/java/expo/modules/inflowcore', path), 'utf8');
const tsSource = readFileSync(join(moduleDir, 'src/index.ts'), 'utf8');

// Compile-time: tsc fails here when the Autopilot members drift from what the screens will call.
type AutopilotApi = Pick<InflowCoreApi, 'suggestions' | 'runSuggestion' | 'skipSuggestion' | 'autopilotSettings' | 'setAutopilotSettings' | 'pickableChats'>;

const settings: AutopilotSettings = {
  kinds: ['reply', 'money'], multiple: 3, minMinor: 500_000, hugeMinor: 5_000_000,
  pickedChats: ['com.whatsapp|num:1'], lookIn: [], bankApp: null, alarmBefore: false,
};

test('a fake of the Autopilot members satisfies the contract', () => {
  let saved: AutopilotSettings | null = null;
  const fake: AutopilotApi = {
    suggestions: (states, limit) => states.includes('waiting') && limit > 0
      ? [{ id: 1, kind: 'reply', title: 'Reply to Ali', item_id: 4, due_at: null, state: 'waiting', created_at: 1, expires_at: 2 }]
      : [],
    runSuggestion: (id) => (id === 1 ? null : 'That suggestion is gone.'),
    skipSuggestion: () => {},
    autopilotSettings: () => settings,
    setAutopilotSettings: (s) => { saved = s; },
    pickableChats: (): PickableChat[] => [{ id: 'com.whatsapp|num:1', name: 'Ali', app: 'WhatsApp' }],
  };
  assert.equal(fake.suggestions(['waiting'], 5).length, 1);
  assert.equal(fake.runSuggestion(2), 'That suggestion is gone.');
  fake.setAutopilotSettings(settings);
  assert.deepEqual(saved, settings);
  // A picked chat is one of the pickable ids.
  assert.ok(fake.pickableChats().some((c) => settings.pickedChats.includes(c.id)));
});

test('AutopilotSettings has the keys Kotlin writes', () => {
  const written = [...kotlin('core/AutopilotSettings.kt').matchAll(/^\s+put\("(\w+)"/gm)].map((m) => m[1]).sort();
  const keys: Record<keyof AutopilotSettings, true> = { kinds: true, multiple: true, minMinor: true, hugeMinor: true, pickedChats: true, lookIn: true, bankApp: true, alarmBefore: true };
  assert.deepEqual(Object.keys(keys).sort(), written);
  // The map the module returns (toMap) names the same keys.
  const mapped = [...kotlin('core/AutopilotApi.kt').matchAll(/"(\w+)" to (?:SuggestionKind|surprise|pickedChats|lookIn|bankApp|alarmBefore)/g)].map((m) => m[1]);
  assert.deepEqual([...mapped].sort(), written);
});

test('every module function is in the TS contract and the other way round', () => {
  const inKotlin = [...kotlin('InflowCoreModule.kt').matchAll(/^\s+(?:Async)?Function\("(\w+)"\)/gm)].map((m) => m[1]).sort();
  const body = tsSource.slice(tsSource.indexOf('export interface InflowCoreApi'), tsSource.indexOf('const InflowCore ='));
  const inTs = [...body.matchAll(/^ {2}(\w+)\(/gm)].map((m) => m[1]).filter((n) => n !== 'addListener').sort();
  assert.deepEqual(inTs, inKotlin);
  assert.ok(inKotlin.length > 60, `found ${inKotlin.length}`);
});

test('the Kotlin module sends the events the TS adapter listens for', () => {
  const events = kotlin('InflowCoreModule.kt').match(/private const val (\w+)_EVENT = "(\w+)"/g) ?? [];
  assert.deepEqual(events.map((e) => e.split('"')[1]).sort(), ['onCaptured', 'onSuggestions']);
  assert.match(tsSource, /addListener\(event: 'onCaptured' \| 'onSuggestions'/);
});
