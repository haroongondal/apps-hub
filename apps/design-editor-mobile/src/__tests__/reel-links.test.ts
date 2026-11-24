import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PROPOSE_TASK, validateExtras, type ExtraSpec } from '@apps-hub/app-link-contract';
import { DEPUTY_APPS, DEPUTY_TEXT, deputyDraft, NEXUS_MAX_PHOTOS, NEXUS_TEXT, nexusProblem, TARGET_MAX } from '../reel/links.ts';

interface Case { name: string; spec: Record<string, ExtraSpec>; raw: Record<string, unknown>; ok: boolean }
const FIXTURE = new URL('../../../../packages/app-link-contract/fixtures/propose-task-extras.json', import.meta.url);
const cases: Case[] = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const expand = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(expand) : typeof v === 'object' && v !== null && 'repeat' in v ? (v as { repeat: string; n: number }).repeat.repeat((v as { n: number }).n) : v;

const FILE = 'Reel 2.mp4';
const draft = (target: string, caption = '', app = '') => {
  const d = deputyDraft(target, caption, app, FILE);
  assert.ok(d.ok, `refused: ${!d.ok && d.reason}`);
  return d.extras;
};

test('the contract fixture is the live PROPOSE_TASK spec, and each case gets its verdict', () => {
  for (const c of cases) {
    assert.deepEqual(c.spec, PROPOSE_TASK.extras, c.name);
    assert.equal(validateExtras(PROPOSE_TASK, Object.fromEntries(Object.entries(c.raw).map(([k, v]) => [k, expand(v)]))).ok, c.ok, c.name);
  }
});

test('the task is Design Editor sentence with the owner words; context and ref are never sent', () => {
  assert.deepEqual(draft('the Family group on WhatsApp', 'Our weekend'), {
    task: 'Send the video Reel 2.mp4 from the Design Editor folder in Movies to the Family group on WhatsApp. Caption: Our weekend',
  });
  assert.deepEqual(draft('  Sara  '), { task: 'Send the video Reel 2.mp4 from the Design Editor folder in Movies to Sara.' });
  assert.deepEqual(draft('Sara', '', 'com.whatsapp'), { task: 'Send the video Reel 2.mp4 from the Design Editor folder in Movies to Sara.', apps: ['com.whatsapp'] });
});

test('the sentence names the reel by file name, not "the newest video", and holds no storage path', () => {
  const { task } = draft('Sara');
  assert.ok(task.includes(FILE));
  assert.doesNotMatch(task, /newest|\/|file:/);
  const none = deputyDraft('Sara', '', '', '  ');
  assert.equal(none.ok, false);
});

test('line breaks and control characters become spaces, so the task stays one line', () => {
  assert.equal(draft('Mum\nand Dad', 'Hi\u0000there\r\n').task, 'Send the video Reel 2.mp4 from the Design Editor folder in Movies to Mum and Dad. Caption: Hi there');
});

test('a long caption is shortened to fit 300, never in the middle of an emoji', () => {
  const long = draft('Sara', 'x'.repeat(400)).task;
  assert.equal(long.length, PROPOSE_TASK.extras.task.max);
  assert.ok(long.endsWith('x…'));
  const emoji = draft('Sara', '😀'.repeat(200)).task;
  assert.ok(emoji.length <= PROPOSE_TASK.extras.task.max);
  assert.doesNotMatch(emoji, /[\ud800-\udbff](?![\udc00-\udfff])/);
  assert.ok(emoji.endsWith('😀…'));
  for (const app of DEPUTY_APPS) assert.ok(validateExtras(PROPOSE_TASK, draft('x'.repeat(TARGET_MAX), 'y'.repeat(2000), app.key)).ok);
});

test('who to send it to is never cut: empty or too long is refused with a sentence', () => {
  const empty = deputyDraft('   ', 'caption', '', FILE);
  assert.equal(empty.ok, false);
  assert.match(!empty.ok ? empty.reason : '', /Type who to send it to/);
  const long = deputyDraft('x'.repeat(TARGET_MAX + 1), '', '', FILE);
  assert.equal(long.ok, false);
  assert.ok(draft('x'.repeat(TARGET_MAX)).task.includes('x'.repeat(TARGET_MAX)));
});

test('every Deputy outcome has plain words', () => {
  assert.deepEqual(Object.keys(DEPUTY_TEXT).sort(), ['busy', 'cancelled', 'handed_over', 'not_installed', 'refused']);
  assert.match(DEPUTY_TEXT.handed_over.text, /tap Start/);
  assert.deepEqual(Object.keys(NEXUS_TEXT).sort(), ['not_installed', 'sent']);
});

test('Nexus takes 1 to 10 photos at a time, as its share screen is built', () => {
  assert.equal(NEXUS_MAX_PHOTOS, 10);
  assert.match(nexusProblem(0) ?? '', /at least one/);
  assert.equal(nexusProblem(1), null);
  assert.equal(nexusProblem(10), null);
  assert.match(nexusProblem(11) ?? '', /up to 10/);
});
