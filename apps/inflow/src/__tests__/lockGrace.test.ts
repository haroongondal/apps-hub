import assert from 'node:assert/strict';
import test from 'node:test';
import { PROMPT_GRACE_MS, beginPermissionPrompt, endPermissionPrompt, permissionPromptOpen } from '../lockGrace.ts';

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
