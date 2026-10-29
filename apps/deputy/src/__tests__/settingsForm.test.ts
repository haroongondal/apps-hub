import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Settings } from 'deputy-agent';
import { fromForm, toForm } from '../settingsForm.ts';

const settings: Settings = {
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  model: 'gemini-3.8-flash',
  customPrices: false,
  inputPerM: 0.75,
  cachedPerM: 0.075,
  outputPerM: 3.75,
  maxSteps: 30,
  maxCostUsd: 1,
  maxMinutes: 10,
  dailyCostUsd: 5,
};

test('a form round-trips the settings', () => {
  assert.deepEqual(fromForm(toForm(settings)), settings);
});

test('an empty number is invalid, never zero, so a cleared price cannot switch off the cost limits', () => {
  const f = fromForm({ ...toForm(settings), inputPerM: ' ', maxCostUsd: '' });
  assert.ok(Number.isNaN(f.inputPerM));
  assert.ok(Number.isNaN(f.maxCostUsd));
});

test('a decimal comma reads as a point', () => {
  assert.equal(fromForm({ ...toForm(settings), outputPerM: '3,5' }).outputPerM, 3.5);
});
