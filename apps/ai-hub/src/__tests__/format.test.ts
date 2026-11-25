import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCount, keysUnreadable, lastUsedText, plainError, requestText, servicesFor, usageText } from '../format.ts';

test('formatCount shortens thousands and millions', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(999), '999');
  assert.equal(formatCount(1000), '1k');
  assert.equal(formatCount(1234), '1.2k');
  assert.equal(formatCount(2_500_000), '2.5M');
});

test('lastUsedText speaks in the largest whole unit', () => {
  const now = 10 * 86_400_000;
  assert.equal(lastUsedText(0, now), 'Never used');
  assert.equal(lastUsedText(now - 30_000, now), 'Used just now');
  assert.equal(lastUsedText(now - 5 * 60_000, now), 'Used 5 min ago');
  assert.equal(lastUsedText(now - 3 * 3_600_000, now), 'Used 3 h ago');
  assert.equal(lastUsedText(now - 86_400_000, now), 'Used 1 day ago');
  assert.equal(lastUsedText(now - 3 * 86_400_000, now), 'Used 3 days ago');
});

test('usageText covers no calls, one call and many', () => {
  assert.equal(usageText({ calls: 0, inputTokens: 0, outputTokens: 0 }), 'No calls yet');
  assert.equal(usageText({ calls: 1, inputTokens: 120, outputTokens: 7 }), '1 call, 120 tokens in, 7 out');
  assert.equal(usageText({ calls: 12, inputTokens: 3400, outputTokens: 1200 }), '12 calls, 3.4k tokens in, 1.2k out');
});

test('plainError keeps only the module message', () => {
  const wrapped = new Error("Call to function 'AiHubCore.addKey' has been rejected.\n→ Caused by: Enter a model id.");
  assert.equal(plainError(wrapped), 'Enter a model id.');
  assert.equal(plainError(new Error('Plain.')), 'Plain.');
  assert.equal(plainError(new Error('')), 'Something went wrong. Try again.');
  const java = new Error("Call to function 'AiHubCore.addKey' has been rejected.\n→ Caused by: java.lang.IllegalArgumentException: This doesn't look like a Gemini key.");
  assert.equal(plainError(java), "This doesn't look like a Gemini key.");
  assert.equal(plainError(new Error('kotlin.IllegalStateException: Your saved keys couldn\'t be opened.')), "Your saved keys couldn't be opened.");
  assert.equal(plainError(new Error('Use a newer app: java.lang.Exception: kept')), 'Use a newer app: java.lang.Exception: kept');
});

test('keysUnreadable spots the vault message', () => {
  assert.ok(keysUnreadable("Your saved keys couldn't be opened. Try again."));
  assert.ok(!keysUnreadable('Enter a model id.'));
});

test('servicesFor matches what each job can run on', () => {
  assert.deepEqual(servicesFor('chat'), ['groq', 'gemini']);
  assert.deepEqual(servicesFor('vision'), ['gemini']);
  assert.deepEqual(servicesFor('embed'), ['gemini']);
  assert.deepEqual(servicesFor('transcribe'), ['groq']);
});

test('requestText names the job, the service and when, never what was asked', () => {
  const now = 10 * 86_400_000;
  assert.equal(requestText({ job: 'chat', service: 'groq', time: now - 5 * 60_000 }, now), 'Chat with Groq. Used 5 min ago');
  assert.equal(requestText({ job: 'vision', service: 'gemini', time: now - 10_000 }, now), 'Images with Gemini. Used just now');
});

test('requestText says why a request failed: kind, HTTP status and whether the other service was tried', () => {
  const now = 10 * 86_400_000;
  const time = now - 10_000;
  assert.equal(
    requestText({ job: 'chat', service: 'groq', time, error: 'bad_request', code: 413 }, now),
    'Chat with Groq failed: request rejected (HTTP 413). Used just now',
  );
  assert.equal(
    requestText({ job: 'chat', service: 'gemini', time, error: 'server', code: 503, fellBack: true }, now),
    'Chat with Gemini failed: service error (HTTP 503), other service tried too. Used just now',
  );
  assert.equal(
    requestText({ job: 'embed', service: 'gemini', time, error: 'server', code: 200, detail: 'fields data, data 1 of 8 texts' }, now),
    'Embeddings with Gemini failed: service error (HTTP 200), fields data, data 1 of 8 texts. Used just now',
  );
  assert.equal(requestText({ job: 'embed', service: 'gemini', time, error: 'offline' }, now), 'Embeddings with Gemini failed: no connection. Used just now');
  assert.equal(requestText({ job: 'chat', service: 'groq', time, error: 'something_new' }, now), 'Chat with Groq failed: unexpected error. Used just now');
});
