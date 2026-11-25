import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The screen has no render harness, so this reads its source: every control that saves must be locked while a save runs.
const src = readFileSync(new URL('../BackgroundChecks.tsx', import.meta.url), 'utf8');

test('every background-check control is disabled while a save is in flight', () => {
  const switches = src.match(/<SwitchRow[\s\S]*?\/>/g) ?? [];
  assert.equal(switches.length, 3);
  for (const s of switches) assert.match(s, /disabled=\{saving\}/);
  assert.match(src, /<View pointerEvents=\{saving \? 'none' : 'auto'\}[\s\S]*?<Segmented/, 'the how-often choice is locked too');
  assert.match(src, /<Button label="Allow"[^>]*disabled=\{saving\}/);
});

test('a save locks the controls before it starts and unlocks them when it ends', () => {
  const change = /setSaving\(true\);\s*void updateHomeWatch\(patch\)\.then\(\(problem\) => \{\s*setNote\(problem\);\s*setSaving\(false\);/;
  assert.match(src, change);
});
