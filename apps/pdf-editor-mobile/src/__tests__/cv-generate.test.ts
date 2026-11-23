import test from 'node:test';
import assert from 'node:assert/strict';

import { editBody, generateBody, type Complete } from '../cv/generate.ts';
import { NOT_A_CV, parseBody, readBody, type CvBody } from '../cv/model.ts';

const reply = (value: unknown): Complete => async () => JSON.stringify(value);

const good = {
  name: 'Ada Lovelace',
  title: 'Analyst',
  contact: ['ada@example.com', ''],
  sections: [
    { heading: 'Summary', entries: [{ title: '', subtitle: '', dates: '', lines: ['Writes engines.'], plain: true }] },
    { heading: 'Skills', entries: [{ title: '', subtitle: '', dates: '', lines: ['Maths', 'Notes'], plain: false }] },
  ],
};

test('parseBody keeps the text, drops empty parts and control characters', () => {
  const body = parseBody({
    ...good,
    name: '  Ada\u0007 Lovelace  ',
    sections: [...good.sections, { heading: '', entries: [] }, { heading: 'Empty', entries: [{ lines: [] }] }],
  });
  assert.equal(body.name, 'Ada Lovelace');
  assert.deepEqual(body.contact, ['ada@example.com']);
  assert.deepEqual(
    body.sections.map((s) => s.heading),
    ['Summary', 'Skills'],
  );
});

test('parseBody refuses a reply without a name', () => {
  assert.throws(() => parseBody({ title: 'x', sections: [] }), (err: Error) => err.message === NOT_A_CV);
  assert.throws(() => parseBody(null), (err: Error) => err.message === NOT_A_CV);
});

test('parseBody caps long fields and the number of sections', () => {
  const body = parseBody({
    name: 'N'.repeat(500),
    sections: Array.from({ length: 30 }, (_, i) => ({ heading: `H${i}`, entries: [{ title: 'T', lines: ['x'.repeat(900)] }] })),
  });
  assert.equal(body.name.length, 120);
  assert.equal(body.sections.length, 12);
  assert.equal(body.sections[0].entries[0].lines[0].length, 400);
});

test('readBody turns text that is not JSON into the not-a-CV error', () => {
  assert.throws(() => readBody('Sure! Here is your CV:'), (err: Error) => err.message === NOT_A_CV);
});

test('generateBody sends the profile and the target role, and returns the parsed CV', async () => {
  const seen: { system: string; user: string; json: boolean }[] = [];
  const complete: Complete = async (system, user, json) => {
    seen.push({ system, user, json });
    return JSON.stringify(good);
  };
  const body = await generateBody('  Built reports at Acme.  ', 'Data analyst', complete);
  assert.equal(body.name, 'Ada Lovelace');
  assert.equal(seen[0].json, true);
  assert.match(seen[0].user, /Target role: Data analyst/);
  assert.match(seen[0].user, /About me:\nBuilt reports at Acme\./);
  assert.match(seen[0].system, /Never invent/);
});

test('editBody sends the current CV and the instruction, and returns the edited CV', async () => {
  const current: CvBody = parseBody(good);
  let sent = '';
  const complete: Complete = async (_system, user) => {
    sent = user;
    return JSON.stringify({ ...good, sections: good.sections.slice(0, 1) });
  };
  const body = await editBody(current, ' Remove the skills section ', complete);
  assert.equal(body.sections.length, 1);
  assert.match(sent, /^Instruction: Remove the skills section\n\nCurrent CV:\n\{"name":"Ada Lovelace"/);
});

test('editBody fails cleanly when the reply is not a CV', async () => {
  await assert.rejects(editBody(parseBody(good), 'shorter', reply({ sections: [] })), (err: Error) => err.message === NOT_A_CV);
});
