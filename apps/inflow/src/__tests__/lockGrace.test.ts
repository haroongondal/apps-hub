import assert from 'node:assert/strict';
import test from 'node:test';
import { PROMPT_GRACE_MS, appStateDecision, beginPermissionPrompt, endPermissionPrompt, permissionPromptOpen } from '../lockGrace.ts';

test('closed until a prompt begins, open while it runs, closed after it ends', () => {
  endPermissionPrompt();
  assert.equal(permissionPromptOpen(1000), false);
  beginPermissionPrompt(1000);
  assert.equal(permissionPromptOpen(1000), true);
  assert.equal(permissionPromptOpen(1000 + 30_000), true);
  endPermissionPrompt();
  assert.equal(permissionPromptOpen(1000 + 30_000), false);
});

test('a forgotten flag expires after 2 minutes', () => {
  beginPermissionPrompt(5000);
  assert.equal(permissionPromptOpen(5000 + PROMPT_GRACE_MS - 1), true);
  assert.equal(permissionPromptOpen(5000 + PROMPT_GRACE_MS), false);
  endPermissionPrompt();
});

test('a clock set back does not keep it open', () => {
  beginPermissionPrompt(5000);
  assert.equal(permissionPromptOpen(4000), false);
  endPermissionPrompt();
});

const T0 = 1_000_000;

test('background with no prompt locks', () => {
  endPermissionPrompt();
  assert.equal(appStateDecision('background', T0), 'lock');
  assert.equal(appStateDecision('active', T0 + 1000), 'none');
});

test('a permission grant keeps the app unlocked: background then active within seconds', () => {
  beginPermissionPrompt(T0);
  assert.equal(appStateDecision('background', T0 + 500), 'keep');
  endPermissionPrompt();
  assert.equal(appStateDecision('active', T0 + 4000), 'keep');
});

test('leaving the picker by Home and returning after 3 minutes locks', () => {
  beginPermissionPrompt(T0);
  assert.equal(appStateDecision('background', T0 + 500), 'keep');
  assert.equal(appStateDecision('active', T0 + 3 * 60_000), 'lock');
  endPermissionPrompt();
});

test('returning after 30 seconds keeps', () => {
  beginPermissionPrompt(T0);
  assert.equal(appStateDecision('background', T0), 'keep');
  assert.equal(appStateDecision('active', T0 + 30_000), 'keep');
  endPermissionPrompt();
});

test('a prompt that ended before the background locks', () => {
  beginPermissionPrompt(T0);
  endPermissionPrompt();
  assert.equal(appStateDecision('background', T0 + 1000), 'lock');
});

test('a clock set back locks', () => {
  beginPermissionPrompt(T0);
  assert.equal(appStateDecision('background', T0 + 1000), 'keep');
  assert.equal(appStateDecision('active', T0 - 5000), 'lock');
  endPermissionPrompt();
});

test('the skipped flag is cleared after one decision', () => {
  beginPermissionPrompt(T0);
  assert.equal(appStateDecision('background', T0), 'keep');
  assert.equal(appStateDecision('active', T0 + 1000), 'keep');
  assert.equal(appStateDecision('active', T0 + 10 * 60_000), 'none');
  endPermissionPrompt();
});

test('a second background while the prompt is open does not extend the grace', () => {
  beginPermissionPrompt(T0);
  assert.equal(appStateDecision('background', T0), 'keep');
  assert.equal(appStateDecision('background', T0 + 90_000), 'keep');
  assert.equal(appStateDecision('active', T0 + 130_000), 'lock');
  endPermissionPrompt();
});

test('inactive changes nothing', () => {
  assert.equal(appStateDecision('inactive', T0), 'none');
});
