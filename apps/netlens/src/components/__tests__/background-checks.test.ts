import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The screen has no render harness, so this reads its source: every control that saves must be locked while a save runs.
const src = readFileSync(new URL('../BackgroundChecks.tsx', import.meta.url), 'utf8');

test('every background-check control is disabled while a save is in flight', () => {
  const switches = src.match(/<SwitchRow[\s\S]*?\/>/g) ?? [];
  assert.equal(switches.length, 3);
  for (const s of switches) assert.match(s, /disabled=\{saving\}/);
  const row = /function SwitchRow[\s\S]*?\n}\n/.exec(src)?.[0] ?? '';
  assert.match(/<Switch[\s\S]*?\/>/.exec(row)?.[0] ?? '', /disabled=\{disabled\}/, 'SwitchRow passes disabled to the real Switch');
  assert.match(src, /<View pointerEvents=\{saving \? 'none' : 'auto'\}[\s\S]*?<Segmented/, 'the how-often choice is locked too');
  const allow = src.slice(src.indexOf('<Button label="Allow"'));
  assert.match(allow.slice(0, allow.indexOf('/>')), /disabled=\{saving\}/);
});
