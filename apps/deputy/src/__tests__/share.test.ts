import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { draftRow, sheetCopy } from '../share.ts';

test('a draft row names the owner’s task and previews the shared text on one line', () => {
  assert.deepEqual(draftRow({ instruction: ' Add it to my calendar ', text: '\n\nDinner at 8\nBring cake', subject: null }), {
    title: 'Add it to my calendar',
    subtitle: 'Shared text: Dinner at 8',
  });
  assert.deepEqual(draftRow({ instruction: '', text: 'x', subject: 'A page' }), { title: 'No task written yet', subtitle: 'Shared text: A page' });
  assert.equal(draftRow({ instruction: '', text: 'y'.repeat(200), subject: null }).subtitle, `Shared text: ${'y'.repeat(79)}…`);
});

test('only the Start button of the shared text sheet starts a draft', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = [...fs.readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => path.join(dir, f)), path.join(dir, '..', 'App.tsx')];
  const callers = files.filter((f) => fs.readFileSync(f, 'utf8').includes('startDraft('));
  assert.deepEqual(callers.map((f) => path.basename(f)), ['SharedTextSheet.tsx']);
  const sheet = fs.readFileSync(path.join(dir, 'SharedTextSheet.tsx'), 'utf8');
  assert.equal(sheet.match(/startDraft\(/g)?.length, 1);
  assert.match(sheet, /const start = \(\) => \{\n\s+const r = DeputyAgent\.startDraft\(/);
  assert.match(sheet, /<Button label="Start" onPress=\{start\}/);
  assert.equal(sheet.match(/\{start\}/g)?.length, 1, 'start is used only as the Start button’s onPress');
  assert.equal(sheet.match(/(?<![\w.])start\(/g), null, 'nothing calls start directly');
});

test('a suggested task names the app that suggested it, and a shared text keeps its own copy', () => {
  assert.deepEqual(draftRow({ instruction: 'Reply to the landlord', text: '', subject: null, source: 'Inflow' }), { title: 'Reply to the landlord', subtitle: 'Suggested by Inflow' });
  assert.deepEqual(sheetCopy({ id: null, source: 'Inflow' }), {
    title: 'Suggested task',
    label: 'What should Deputy do?',
    hint: 'Suggested by Inflow. Change it as you like before you tap Start.',
  });
  assert.equal(sheetCopy({ id: null, source: null }).title, 'New task from shared text');
  assert.equal(sheetCopy({ id: 'd1', source: null }).title, 'Draft task');
});

test('a proposed task reaches the screen only as a sheet: nothing outside the Start button starts it', () => {
  const app = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'App.tsx'), 'utf8');
  for (const word of ['startDraft(', 'startRun(', 'saveDraft(']) assert.equal(app.includes(word), false, word);
  const take = app.slice(app.indexOf('const takeProposal'), app.indexOf('}, [open]);', app.indexOf('const takeProposal')));
  assert.match(take, /if \(p\) open\(\{ id: null, instruction: p\.instruction, text: p\.text, subject: null, cut: false, source: p\.source, apps: p\.apps, proposalId: p\.id \}\)/);
});
