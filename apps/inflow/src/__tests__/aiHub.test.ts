import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { FREE_TIER_NOTE, HUB_ACTION, HUB_COPY, hubIssueOf, issueOfAvailability, type HubIssue } from '../aiHub.ts';
import { HEALTH_IN_ASK_NOTE, HEALTH_PRIVACY, SENDS_NOTICE } from '../doctor.ts';

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'modules', 'inflow-core', 'fixtures', 'ai-hub-copy.json'), 'utf8'));

test('the words on screen are the words the native side writes (HubCopyTest.kt reads the same file)', () => {
  assert.deepEqual(HUB_COPY, fixture);
});

test('each hub state has plain words and one button that opens the Store or AI hub', () => {
  assert.deepEqual(HUB_ACTION.missing, { label: 'Install AI hub', opens: 'store' });
  assert.deepEqual(HUB_ACTION['not-allowed'], { label: 'Open AI hub', opens: 'hub' });
  assert.deepEqual(HUB_ACTION['no-key'], { label: 'Open AI hub', opens: 'hub' });
  assert.equal(HUB_COPY.missing, 'AI needs AI hub.');
  assert.equal(HUB_COPY['not-allowed'], 'Allow Inflow in AI hub.');
  assert.equal(HUB_COPY['no-key'], 'Add a key in AI hub.');
  for (const k of Object.keys(HUB_COPY) as HubIssue[]) assert.match(HUB_COPY[k], /AI hub\.$/);
});

test('hubIssueOf knows only the four hub texts', () => {
  for (const k of Object.keys(HUB_COPY) as HubIssue[]) assert.equal(hubIssueOf(HUB_COPY[k]), k);
  assert.equal(hubIssueOf(null), null);
  assert.equal(hubIssueOf('AI hub is busy. Inflow will try again later.'), null);
  assert.equal(hubIssueOf("The AI took too long to answer. Try again."), null);
});

test('only a missing, refused or too old hub is a screen state; a ready hub or another failure shows nothing', () => {
  assert.equal(issueOfAvailability({ ok: true, version: 2 }), null);
  assert.equal(issueOfAvailability({ ok: false, kind: 'hub-missing', message: 'x' }), 'missing');
  assert.equal(issueOfAvailability({ ok: false, kind: 'not-allowed', message: 'x' }), 'not-allowed');
  assert.equal(issueOfAvailability({ ok: false, kind: 'version', message: 'x' }), 'version');
  assert.equal(issueOfAvailability({ ok: false, kind: 'timeout', message: 'x' }), null);
});

test('both health consents name Groq and Gemini, say what AI hub keeps and carry the free-tier note', () => {
  assert.equal(HEALTH_PRIVACY, 'Your health text goes to Groq, or to Gemini when Groq has no working key, through AI hub. AI hub keeps only counts, never the text.');
  for (const text of [HEALTH_IN_ASK_NOTE, SENDS_NOTICE]) {
    assert.ok(text.includes(HEALTH_PRIVACY));
    assert.ok(text.includes(FREE_TIER_NOTE));
    assert.match(text, /Groq/);
    assert.match(text, /Gemini/);
    assert.match(text, /free-tier/);
    assert.match(text, /keeps only counts, never the text/);
  }
  assert.ok(HEALTH_IN_ASK_NOTE.endsWith('Off by default.'));
  assert.ok(SENDS_NOTICE.includes('Nothing is sent until you tap Send.'));
  assert.match(FREE_TIER_NOTE, /billing turned on/);
});
