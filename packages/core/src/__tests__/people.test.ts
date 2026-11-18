import test from 'node:test';
import assert from 'node:assert/strict';

import { carryPersonTags, peopleStatus, probeHome } from '../people.ts';
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
