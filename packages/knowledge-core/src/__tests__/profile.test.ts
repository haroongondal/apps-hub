import assert from 'node:assert/strict';
import { test } from 'node:test';

import { answerMessages } from '../prompts.ts';
import { isProfileQuestion, normaliseCitations, wantsCvs } from '../profile.ts';
import { setup } from './helpers.ts';

test('broad questions about the owner are profile questions; specific ones are not', () => {
  for (const q of ['what do you know about me', 'Tell me about myself', 'who am I?', 'summarise me']) assert.ok(isProfileQuestion(q), q);
  for (const q of ['when does the depot open', 'what did the doctor say about my knee', 'how do I make a cake']) assert.ok(!isProfileQuestion(q), q);
  assert.ok(wantsCvs('what is on my resume') && wantsCvs('what is my work experience') && wantsCvs('list my skills'));
  assert.ok(!wantsCvs('where is my parcel') && !wantsCvs('what skills does the course teach') && !wantsCvs('how much experience does kafka need'));
});

test('citations written as 【2†source】 become [2]', () => {
  assert.equal(normaliseCitations('He asked 【1†source】 【3†L5-L9】 and left.'), 'He asked [1] [3] and left.');
});

test('the answer prompt names the owner, or says not to guess a name', () => {
  const [named] = answerMessages('who am i', ['x'], { profile: true, about: { name: 'Sam Reed', notes: 'I live in Lahore.\nI run daily.' } });
  assert.match(named.content, /The user is Sam Reed/);
  assert.match(named.content, /I live in Lahore\. I run daily\./);
  assert.match(named.content, /Not found:/);
  const [anon] = answerMessages('who am i', ['x']);
  assert.match(anon.content, /never guess it/);
  assert.doesNotMatch(anon.content, /Not found:/);
});

test('a profile question searches every part of a life and is not drowned by messages', async () => {
  const { kn, ai, add, drain, db } = await setup();
  const medical = await add('Clinic report', 'doctor diagnosis medicine prescription lab test result allergy', 'pdf');
  const bank = await add('Salary slip', 'bank account salary payment tax balance', 'pdf');
  const cv = await add('Resume', 'job title employer work experience skills projects resume', 'pdf');
  for (let i = 0; i < 12; i++) {
    const m = await add(`Message ${i}`, `how are you doing, any questions about the requirements documents ${i}`);
    await db.run("INSERT INTO item_sources (item_id, app, source_id, source_at) VALUES (?, 'inflow', ?, 1)", [m.id, i + 1]);
  }
  await drain();

  let seen: string[] = [];
  ai.onAnswer = (_q, sources) => ((seen = sources), 'Profile [1].');
  const answer = await kn.ask('what do you know about me', { about: { name: 'Sam Reed' } });

  for (const title of ['Clinic report', 'Salary slip', 'Resume']) assert.ok(seen.some((s) => s.startsWith(title)), `${title} reaches the model`);
  assert.ok(seen.filter((s) => s.startsWith('From Inflow')).length <= 7, 'at most one message per area');
  assert.deepEqual(ai.lastAnswerOpts, { profile: true, about: { name: 'Sam Reed' } });
  assert.deepEqual(answer.citations.map((c) => c.itemId), [seen[0].startsWith('Clinic') ? medical.id : seen[0].startsWith('Salary') ? bank.id : cv.id].filter(Boolean));
});

test('CVs ride along for a profile or CV question, not for others', async () => {
  const { kn, ai, add, drain } = await setup();
  await add('Depot hours', 'the depot opens at nine for parcel pickup');
  await drain();
  const extras = [{ id: 'cv:1', title: 'CV: Sam Reed', text: 'Sam Reed, engineer at Acme' }];
  let seen: string[] = [];
  ai.onAnswer = (_q, sources) => ((seen = sources), 'Engineer [1].');
  const about = await kn.ask('who am i', { extras });
  assert.equal(seen[0], 'CV: Sam Reed: Sam Reed, engineer at Acme');
  assert.deepEqual(about.citations.map((c) => c.itemId), ['cv:1']);
  await kn.ask('depot parcel', { extras, about: { name: 'Sam Reed' } });
  assert.ok(!seen.some((s) => s.includes('Acme')));
  assert.deepEqual(ai.lastAnswerOpts, { profile: false, about: undefined });
});

test('a profile question over an empty library still answers without calling the model', async () => {
  const { kn, ai } = await setup();
  assert.deepEqual((await kn.ask('what do you know about me')).citations, []);
  assert.equal(ai.calls.answer, 0);
});
