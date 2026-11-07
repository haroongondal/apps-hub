import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerRequest, pickerResult, stepRequest, stepResult, summarise, type Screen } from '../bench.ts';

const screen: Screen = {
  id: '01',
  app: 'Settings',
  task: 'Turn on Bluetooth',
  subgoal: 'Open Bluetooth settings',
  lines: ['[3] text "Wi-Fi" clickable', '[7] text "Bluetooth" clickable off'],
  answer: '7',
};

test('pickerRequest builds one choice question over the indexes', () => {
  const body = pickerRequest(screen) as any;
  assert.equal(body.questions.next.type, 'choice');
  assert.deepEqual(Object.keys(body.questions.next.criteria), ['3', '7', 'done', 'unsure']);
  for (const part of [screen.task, screen.subgoal, ...screen.lines]) assert.ok(body.state.includes(part), part);
});

// laya-type deciders cut the question and options to ~192-256 tokens, so both stay short
test('pickerRequest puts the sub-goal first in the question and keeps only kind and label as options', () => {
  const body = pickerRequest({ ...screen, lines: [...screen.lines, '[9] image'] }) as any;
  assert.ok(body.questions.next.instructions.startsWith(`Sub-goal: ${screen.subgoal}`));
  assert.equal(body.questions.next.criteria['7'], 'text "Bluetooth"');
  assert.equal(body.questions.next.criteria['9'], 'image');
});

test('pickerRequest rejects a line without an index', () => {
  assert.throws(() => pickerRequest({ ...screen, lines: ['Wi-Fi'] }), /line 1 has no \[n\] index/);
});

test('pickerResult marks the top choice', () => {
  const r = pickerResult(screen, { answers: { next: { choice: '7', probabilities: { '7': 0.9, '3': 0.1 } } } }, 42);
  assert.deepEqual(r, { id: '01', choice: '7', top: 0.9, ms: 42, correct: true });
});

test('pickerResult records a server error, not a wrong answer', () => {
  const r = pickerResult(screen, { error: { message: 'too many options' } }, 5);
  assert.equal(r.choice, 'error');
  assert.equal(r.correct, false);
  assert.equal(r.error, 'too many options');
});

test('stepRequest attaches the screenshot only when given', () => {
  const plain = stepRequest(screen, null) as any;
  const withImage = stepRequest(screen, 'data:image/png;base64,AA') as any;
  assert.equal(typeof plain.messages.at(-1).content, 'string');
  const parts = withImage.messages.at(-1).content;
  assert.ok(Array.isArray(parts));
  assert.ok(parts.some((p: any) => p.type === 'image_url' && p.image_url.url === 'data:image/png;base64,AA'));
  for (const body of [plain, withImage]) {
    assert.equal(body.tool_choice, 'required');
    assert.equal(body.temperature, 0);
    assert.equal(body.max_tokens, 128);
    assert.deepEqual(body.tools.map((t: any) => t.function.name), ['tap', 'back', 'done']);
  }
});

test('stepResult accepts only a known tool with JSON arguments', () => {
  const timings = { prompt_ms: 120, predicted_ms: 30 };
  const ok = stepResult(screen, {
    choices: [{ message: { tool_calls: [{ function: { name: 'tap', arguments: '{"index":7}' } }] } }],
    timings,
  }, 200);
  assert.equal(ok.valid, true);
  assert.equal(ok.tool, 'tap');
  assert.equal(ok.args, '{"index":7}');
  assert.equal(ok.promptMs, 120);
  assert.equal(ok.decodeMs, 30);
  const text = stepResult(screen, { choices: [{ message: { content: 'Tap Bluetooth' } }], timings }, 200);
  assert.equal(text.valid, false);
  assert.equal(text.tool, null);
  const unknown = stepResult(screen, {
    choices: [{ message: { tool_calls: [{ function: { name: 'swipe', arguments: '{}' } }] } }],
  }, 1);
  assert.equal(unknown.valid, false);
  const badJson = stepResult(screen, {
    choices: [{ message: { tool_calls: [{ function: { name: 'tap', arguments: '{index' } }] } }],
  }, 1);
  assert.equal(badJson.valid, false);
});

test('summarise counts and takes the median', () => {
  const s = summarise([{ ms: 5, correct: true }, { ms: 1, valid: true }, { ms: 3, correct: false }]);
  assert.deepEqual(s, { ok: 2, total: 3, medianMs: 3, maxMs: 5 });
});

test('summarise leaves error rows out of the timing', () => {
  const s = summarise([{ ms: 9000, valid: true }, { ms: 2, valid: false, error: 'process died' }]);
  assert.deepEqual(s, { ok: 1, total: 2, medianMs: 9000, maxMs: 9000 });
});
