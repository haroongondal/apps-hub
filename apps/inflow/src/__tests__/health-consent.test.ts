import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// No React Native renderer here, so these pin the source: health stays off until the owner flips a switch or taps Send, and only those screens can do either.
const src = join(import.meta.dirname, '..');
const read = (name: string) => readFileSync(join(src, name), 'utf8');
const screens = readdirSync(src).filter((f) => f.endsWith('.tsx') || (f.endsWith('.ts') && f !== 'doctor.ts' && !f.endsWith('.d.ts')));
const callers = (needle: string) => screens.filter((f) => read(f).includes(needle));

test('the two health switches start Off and the screen shows what the phone says', () => {
  const settings = read('SettingsScreen.tsx');
  assert.ok(settings.includes('const [healthAsk, setHealthAsk] = useState(false);'));
  assert.ok(settings.includes('const [healthBriefing, setHealthBriefing] = useState(false);'));
  assert.ok(settings.includes('setHealthAsk(InflowCore.healthInAsk());'));
  assert.ok(settings.includes('setHealthBriefing(InflowCore.healthInBriefing());'));
});

test('only the Settings segmented controls turn a health switch on, and only when On is picked', () => {
  assert.deepEqual(callers('setHealthInAsk('), ['SettingsScreen.tsx']);
  assert.deepEqual(callers('setHealthInBriefing('), ['SettingsScreen.tsx']);
  const settings = read('SettingsScreen.tsx');
  assert.equal(settings.match(/InflowCore\.setHealthInAsk\(/g)?.length, 1);
  assert.equal(settings.match(/InflowCore\.setHealthInBriefing\(/g)?.length, 1);
  assert.ok(settings.includes("onChange={(k) => change(() => InflowCore.setHealthInAsk(k === 'on'))}"));
  assert.ok(settings.includes("onChange={(k) => change(() => InflowCore.setHealthInBriefing(k === 'on'))}"));
});

test('the Doctor summary is sent only from the review screen, with the hash of the text the owner read', () => {
  assert.deepEqual(callers('doctorSummarize('), ['DoctorScreen.tsx']);
  const doctor = read('DoctorScreen.tsx');
  assert.equal(doctor.match(/doctorSummarize\(/g)?.length, 1);
  const send = doctor.slice(doctor.indexOf('const send = async'));
  const at = (text: string) => { const i = send.indexOf(text); assert.ok(i >= 0, text); return i; };
  const call = at('doctorSummarize(');
  assert.ok(at("if (step.kind !== 'review') return;") < call);
  assert.ok(at('if (hash === null) return toChoose();') < call);
  assert.ok(send.includes('InflowCore.doctorSummarize(shown.fromDay, shown.toDay, shown.include, hash)'));
});
