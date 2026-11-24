import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';

import { cleanMdnsInstanceName } from '../device-names.ts';
import {
  carryPersonTags,
  isGenericDeviceName,
  ownerOfName,
  peopleStatus,
  personTagCarries,
  personTagSuggestions,
  probeHome,
} from '../people.ts';
import type { ReconciledDevice } from '../device-repository.ts';
import type { ProbeOutcome } from '../model.ts';

let nextId = 1;
function dev(over: Partial<ReconciledDevice> = {}): ReconciledDevice {
  const id = nextId++;
  return {
    id,
    networkId: 'net',
    identityKey: `key-${id}`,
    lastIp: `192.168.1.${id}`,
    hostname: null,
    customName: null,
    vendorOrModel: null,
    openPortsCsv: '',
    mdnsServicesCsv: '',
    isTrusted: false,
    firstSeenAt: 1,
    lastSeenAt: 1,
    mdnsName: null,
    friendlyName: null,
    model: null,
    netbiosName: null,
    person: null,
    mac: null,
    isNew: false,
    seenThisScan: false,
    ...over,
  };
}

// peopleStatus

test('Sara and sara collapse to one person, home when one device is seen', () => {
  const a = dev({ person: 'Sara', seenThisScan: true, lastSeenAt: 5 });
  const b = dev({ person: ' sara ', lastSeenAt: 9 });
  const out = peopleStatus([a, b]);
  assert.deepEqual(out, [{ person: 'Sara', home: true, lastSeenAt: 9, deviceIds: [a.id, b.id] }]);
});

test('nobody seen: away with the newest lastSeenAt', () => {
  const out = peopleStatus([dev({ person: 'Omar', lastSeenAt: 3 }), dev({ person: 'Omar', lastSeenAt: 8 })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].home, false);
  assert.equal(out[0].lastSeenAt, 8);
});

test('blank and whitespace tags are ignored; null ids are skipped', () => {
  const out = peopleStatus([dev({ person: '   ' }), dev({ person: '' }), dev({ person: null }), dev({ person: 'Li', id: null })]);
  assert.deepEqual(out, [{ person: 'Li', home: false, lastSeenAt: 1, deviceIds: [] }]);
});

test('sorted home first, then by name', () => {
  const out = peopleStatus([
    dev({ person: 'Zed', seenThisScan: true }),
    dev({ person: 'amy' }),
    dev({ person: 'Bob' }),
    dev({ person: 'Cy', seenThisScan: true }),
  ]);
  assert.deepEqual(out.map((p) => p.person), ['Cy', 'Zed', 'amy', 'Bob']);
});

// carryPersonTags

const stale = (over: Partial<ReconciledDevice> = {}) => dev({ person: 'Sara', hostname: 'saras-phone', ...over });
const fresh = (over: Partial<ReconciledDevice> = {}) => dev({ seenThisScan: true, hostname: 'saras-phone', ...over });

test('carry: tag moves to the seen untagged row with the same hostname; only changed rows returned', () => {
  const old = stale({ customName: 'Sara phone', isTrusted: true });
  const nu = fresh({ customName: 'x', isTrusted: false });
  const other = dev({ hostname: 'tv' });
  const out = carryPersonTags([old, nu, other]);
  assert.deepEqual(out, [
    { ...old, person: null },
    { ...nu, person: 'Sara' },
  ]);
  // customName and isTrusted stay put on both rows
  assert.equal(out[0].customName, 'Sara phone');
  assert.equal(out[0].isTrusted, true);
  assert.equal(out[1].customName, 'x');
  assert.equal(out[1].isTrusted, false);
});

test('carry: inputs are not mutated', () => {
  const old = stale();
  const nu = fresh();
  const input = [old, nu];
  const snapshot = JSON.stringify(input);
  carryPersonTags(input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.equal(input.length, 2);
});

test('carry: case-insensitive hostname match carries', () => {
  const out = carryPersonTags([stale({ hostname: 'Saras-Phone' }), fresh({ hostname: 'SARAS-phone' })]);
  assert.equal(out.length, 2);
});

test('carry: a match on mdnsName carries', () => {
  const out = carryPersonTags([
    stale({ hostname: null, mdnsName: 'sara.local' }),
    fresh({ hostname: null, mdnsName: 'Sara.local' }),
  ]);
  assert.equal(out.length, 2);
});

test('carry: hostname equal to the other row\'s mdnsName does NOT carry (same field only)', () => {
  const out = carryPersonTags([
    stale({ hostname: 'sara.local', mdnsName: null }),
    fresh({ hostname: null, mdnsName: 'sara.local' }),
  ]);
  assert.deepEqual(out, []);
});

test('no carry: two seen untagged rows share the name (ambiguous)', () => {
  assert.deepEqual(carryPersonTags([stale(), fresh(), fresh()]), []);
});

test('no carry: the tagged row has no hostname and no mdnsName', () => {
  const out = carryPersonTags([
    stale({ hostname: null, mdnsName: null }),
    fresh({ hostname: null, mdnsName: null }),
  ]);
  assert.deepEqual(out, []);
});

test('no carry: the candidate has no names while the tagged row has names', () => {
  assert.deepEqual(carryPersonTags([stale({ mdnsName: 'sara.local' }), fresh({ hostname: null, mdnsName: null })]), []);
});

test('no carry: the tagged row was seen this scan (tag stays)', () => {
  assert.deepEqual(carryPersonTags([stale({ seenThisScan: true }), fresh()]), []);
});

test('no carry: the candidate is already tagged (no overwrite)', () => {
  assert.deepEqual(carryPersonTags([stale(), fresh({ person: 'Omar' })]), []);
});

test('no carry: the candidate was not seen this scan', () => {
  assert.deepEqual(carryPersonTags([stale(), fresh({ seenThisScan: false })]), []);
});

test('no carry: names differ', () => {
  assert.deepEqual(carryPersonTags([stale(), fresh({ hostname: 'tv' })]), []);
});

test('no carry: empty-string names on both sides never match', () => {
  const out = carryPersonTags([
    stale({ hostname: '', mdnsName: '' }),
    fresh({ hostname: '', mdnsName: '' }),
  ]);
  assert.deepEqual(out, []);
});

test('whitespace-only tag counts as untagged: it is a valid candidate and never a source', () => {
  const out = carryPersonTags([stale(), fresh({ person: '   ' })]);
  assert.equal(out[1].person, 'Sara');
  assert.deepEqual(carryPersonTags([stale({ person: '  ' }), fresh()]), []);
});

test('two tagged rows match one candidate: the first moves, the second keeps its tag', () => {
  const first = stale({ person: 'Sara' });
  const second = stale({ person: 'Omar' });
  const nu = fresh();
  const out = carryPersonTags([first, second, nu]);
  assert.deepEqual(out, [{ ...first, person: null }, { ...nu, person: 'Sara' }]);
});

test('no carry: a generic hostname or mdnsName never carries a tag', () => {
  for (const name of ['iPhone', 'android', 'Galaxy-S21', 'Pixel-7', 'localhost']) {
    assert.deepEqual(carryPersonTags([stale({ hostname: name }), fresh({ hostname: name })]), [], `hostname ${name}`);
    assert.deepEqual(
      carryPersonTags([stale({ hostname: null, mdnsName: name }), fresh({ hostname: null, mdnsName: name })]),
      [],
      `mdnsName ${name}`,
    );
  }
});

test('carry: a personal name that contains a device word still carries', () => {
  const out = carryPersonTags([stale({ hostname: 'Saras-iPhone' }), fresh({ hostname: 'saras-iphone' })]);
  assert.equal(out.length, 2);
  assert.equal(out[1].person, 'Sara');
});

test('no carry: a guest\'s untagged "iPhone" does not take Sara\'s tag from her stale "iPhone" row', () => {
  assert.deepEqual(carryPersonTags([stale({ hostname: 'iPhone' }), fresh({ hostname: 'iPhone' })]), []);
});

test('carry: generic hostname with a personal mdnsName still carries via mdns', () => {
  const out = carryPersonTags([
    stale({ hostname: 'iPhone', mdnsName: 'saras-iphone.local' }),
    fresh({ hostname: 'iPhone', mdnsName: 'Saras-iPhone.local' }),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[1].person, 'Sara');
});

test('isGenericDeviceName: table', () => {
  const generic = [
    'iPhone', 'iPad', 'android', 'Android-1234', 'Galaxy-S21', 'galaxy_s21', 'Pixel-7', 'Pixel 7', 'Redmi Note 10',
    'Note10', 'localhost', 'Unknown', 'iPhone 12', 'OnePlus-8T', 'Galaxy-A52', 'Samsung Galaxy', 'Mi Watch', '',
    '   ', '---',
  ];
  const personal = ['Sara', 'Saras-iPhone', 'Haroons-iPad', 'Sara-Galaxy-S21', 'Omar iPhone', 'saras-phone', 'Pixel-Sara', 'ESP-A1B2C3'];
  for (const n of generic) assert.equal(isGenericDeviceName(n), true, `generic: "${n}"`);
  for (const n of personal) assert.equal(isGenericDeviceName(n), false, `personal: "${n}"`);
});

// probeHome

function fakeBinding(outcomes: Record<number, ProbeOutcome | 'throw'>) {
  const calls: { ip: string; port: number; timeoutMs: number }[] = [];
  return {
    calls,
    async measureTcpHandshake(ip: string, port: number, timeoutMs: number) {
      calls.push({ ip, port, timeoutMs });
      const outcome = outcomes[port] ?? 'timeout';
      if (outcome === 'throw') throw new Error('bridge down');
      return { outcome, rttMs: outcome === 'open' || outcome === 'refused' ? 2 : null };
    },
  };
}

test('probeHome: refused counts as home and stops at the first hit', async () => {
  const b = fakeBinding({ 80: 'refused', 443: 'open' });
  assert.equal(await probeHome(b, '10.0.0.7'), true);
  assert.deepEqual(b.calls.map((c) => c.port), [62078, 80]);
  assert.ok(b.calls.every((c) => c.ip === '10.0.0.7' && c.timeoutMs === 800));
});

test('probeHome: all timeouts tries every port in order and reads as away', async () => {
  const b = fakeBinding({ 22: 'unreachable' });
  assert.equal(await probeHome(b, '10.0.0.7'), false);
  assert.deepEqual(b.calls.map((c) => c.port), [62078, 80, 443, 22, 445, 5353, 8080]);
});

test('probeHome: a rejected call is not reachable and does not throw', async () => {
  const b = fakeBinding({ 62078: 'throw', 80: 'open' });
  assert.equal(await probeHome(b, '10.0.0.7'), true);
  assert.deepEqual(b.calls.map((c) => c.port), [62078, 80]);
});

// Bonjour names as a second and third carry signal (phones with generic hostnames)

const ownerCases: { serviceType: string; raw: string; clean: string; owner: string | null }[] = JSON.parse(
  fs.readFileSync(new URL('../../fixtures/mdns-owner-names.json', import.meta.url), 'utf8'),
);

for (const c of ownerCases) {
  test(`owner fixture (${c.serviceType}): ${c.raw}`, () => {
    const clean = cleanMdnsInstanceName(c.raw);
    assert.equal(clean, c.clean);
    assert.equal(ownerOfName(clean), c.owner);
  });
}

test('carry: a generic "iPhone" row moves to the new row that announces the same Bonjour name', () => {
  const old = dev({ person: 'Sara', hostname: 'iPhone', mdnsName: 'Sara’s iPhone' });
  const fresh = dev({ seenThisScan: true, hostname: 'iPhone', mdnsName: 'Living room speaker' });
  const names = new Map([[fresh.lastIp, ['Living room speaker', 'Sara’s iPhone']]]);
  const [carry] = personTagCarries([old, fresh], names);
  assert.equal(carry.person, 'Sara');
  assert.equal(carry.device.id, fresh.id);
  assert.equal(carry.reason, 'It announces the same name, Sara’s iPhone');
  assert.deepEqual(carryPersonTags([old, fresh], names).map((d) => [d.id, d.person]), [[old.id, null], [fresh.id, 'Sara']]);
});

test('suggest, no carry: an "android" phone whose Bonjour name has the owner word of the tag is only suggested', () => {
  const old = dev({ person: 'haroon', hostname: 'android' });
  const fresh = dev({ seenThisScan: true, hostname: 'android' });
  const names = new Map([[fresh.lastIp, ['Haroon’s Pixel']]]);
  assert.deepEqual(personTagCarries([old, fresh], names), []);
  assert.deepEqual(carryPersonTags([old, fresh], names), []);
  const [s] = personTagSuggestions([old, fresh], names);
  assert.equal(s.reason, 'It calls itself Haroon’s Pixel');
  assert.equal(s.from.id, old.id);
  assert.equal(s.device.id, fresh.id);
  assert.equal(s.device.person, 'haroon');
});

test('no carry: a sleeping tagged phone keeps its tag when the owner’s laptop calls itself Sara’s MacBook Pro', () => {
  const phone = dev({ person: 'Sara', hostname: 'android' });
  const laptop = dev({ seenThisScan: true, mdnsName: 'Sara’s MacBook Pro' });
  assert.deepEqual(carryPersonTags([phone, laptop]), []);
  assert.deepEqual(personTagCarries([phone, laptop]), []);
  assert.deepEqual(personTagSuggestions([phone, laptop]).map((s) => [s.from.id, s.device.id]), [[phone.id, laptop.id]]);
});

test('no carry: a guest device announcing “Sara’s iPhone” does not take the tag', () => {
  const phone = dev({ person: 'Sara', hostname: 'iPhone' });
  const guest = dev({ seenThisScan: true });
  const names = new Map([[guest.lastIp, ['Sara’s iPhone']]]);
  assert.deepEqual(carryPersonTags([phone, guest], names), []);
  assert.deepEqual(personTagCarries([phone, guest], names), []);
});

test('no carry: the owner word belongs to someone else', () => {
  const old = dev({ person: 'Sara', hostname: 'iPhone' });
  const fresh = dev({ seenThisScan: true, hostname: 'iPhone' });
  assert.deepEqual(personTagCarries([old, fresh], new Map([[fresh.lastIp, ['Ali’s iPhone']]])), []);
});

test('no carry: two new rows call themselves Sara’s (ambiguous)', () => {
  const old = dev({ person: 'Sara' });
  const a = dev({ seenThisScan: true });
  const b = dev({ seenThisScan: true, mdnsName: 'Sara’s iPad' });
  assert.deepEqual(personTagCarries([old, a, b], new Map([[a.lastIp, ['Sara’s iPhone']]])), []);
});

test('no carry: a generic announced name never matches the old row', () => {
  const old = dev({ person: 'Sara', mdnsName: 'iPhone' });
  const fresh = dev({ seenThisScan: true });
  assert.deepEqual(personTagCarries([old, fresh], new Map([[fresh.lastIp, ['iPhone']]])), []);
});

test('the name match still wins: an ambiguous name match is not rescued by a Bonjour owner match', () => {
  const old = dev({ person: 'Sara', hostname: 'sara-laptop' });
  const a = dev({ seenThisScan: true, hostname: 'sara-laptop' });
  const b = dev({ seenThisScan: true, hostname: 'sara-laptop' });
  const c = dev({ seenThisScan: true });
  assert.deepEqual(personTagCarries([old, a, b, c], new Map([[c.lastIp, ['Sara’s iPhone']]])), []);
});

test('the name match keeps its reason and wins over a Bonjour owner match on another row', () => {
  const old = dev({ person: 'Sara', hostname: 'sara-laptop' });
  const a = dev({ seenThisScan: true, hostname: 'Sara-Laptop' });
  const c = dev({ seenThisScan: true });
  const carries = personTagCarries([old, a, c], new Map([[c.lastIp, ['Sara’s iPhone']]]));
  assert.deepEqual(carries.map((x) => [x.device.id, x.reason]), [[a.id, 'Same name on the network, Sara-Laptop']]);
});
