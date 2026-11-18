import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScanEventName, ServiceEvent } from '../model.ts';
import { collectServiceEvents, isDiscoveryRunningError } from '../service-discovery.ts';
import { TcpScanEngine } from '../tcp-scan-engine.ts';
import type { NetLensNativeBinding } from '../native-binding.ts';

const running = new Error('Call to function has been rejected.\n→ Caused by: A service discovery is already running');
const ssdp: ServiceEvent = { kind: 'ssdp', host: '192.168.1.1', location: 'http://192.168.1.1:5000/d.xml', server: null, usn: null };

// A binding whose discovery start is scripted; emit() reaches the listeners the code under test added.
function fake(start: () => Promise<void>) {
  const listeners = new Map<string, Array<(...a: unknown[]) => void>>();
  const binding = {
    addListener(event: ScanEventName, listener: (...a: unknown[]) => void) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return { remove: () => void list.splice(list.indexOf(listener), 1) };
    },
    startServiceDiscovery: start,
  } as unknown as Pick<NetLensNativeBinding, 'addListener' | 'startServiceDiscovery'> & NetLensNativeBinding;
  const emit = (event: string, ...args: unknown[]): void => {
    for (const l of [...(listeners.get(event) ?? [])]) l(...args);
  };
  const count = (): number => [...listeners.values()].reduce((n, l) => n + l.length, 0);
  return { binding, emit, count };
}

test('isDiscoveryRunningError matches only the already-running rejection', () => {
  assert.equal(isDiscoveryRunningError(running), true);
  assert.equal(isDiscoveryRunningError(new Error('A service discovery is already running')), true);
  for (const e of [new Error('A TCP scan is already running'), new Error('React context unavailable'), 'boom', null, undefined]) {
    assert.equal(isDiscoveryRunningError(e), false, String(e));
  }
});

test('a rejection because a discovery is running keeps listening until that one completes', async () => {
  const f = fake(() => Promise.reject(running));
  const run = collectServiceEvents(f.binding, 60_000, 60_000);
  setTimeout(() => f.emit('onServiceDiscovered', ssdp), 5);
  setTimeout(() => f.emit('onServiceScanComplete', { mdnsCount: 0, ssdpCount: 1, cancelled: false }), 15);
  assert.deepEqual(await run.events, [ssdp]);
  assert.equal(f.count(), 0);
});

test('a running discovery that never completes is cut off at the duration', async () => {
  const f = fake(() => Promise.reject(running));
  const run = collectServiceEvents(f.binding, 30, 60_000);
  setTimeout(() => f.emit('onServiceDiscovered', ssdp), 5);
  assert.deepEqual(await run.events, [ssdp]);
  assert.equal(f.count(), 0);
});

test('any other rejection returns what arrived without waiting', async () => {
  const f = fake(() => Promise.reject(new Error('React context unavailable')));
  const started = Date.now();
  const run = collectServiceEvents(f.binding, 60_000, 60_000);
  assert.deepEqual(await run.events, []);
  assert.ok(Date.now() - started < 1000);
  assert.equal(f.count(), 0);
});

test('a normal start returns when it resolves, and cancel ends a wait and removes the listeners', async () => {
  const ok = fake(() => Promise.resolve());
  assert.deepEqual(await collectServiceEvents(ok.binding, 60_000, 60_000).events, []);
  const stuck = fake(() => new Promise<void>(() => undefined));
  const run = collectServiceEvents(stuck.binding, 60_000, 60_000);
  assert.equal(stuck.count(), 2);
  run.cancel();
  await run.events;
  assert.equal(stuck.count(), 0);
});

test('discoverServices does not fail on an already-running rejection and finishes with the running one', async () => {
  const f = fake(() => Promise.reject(running));
  const engine = new TcpScanEngine(f.binding);
  const pending = engine.discoverServices(60_000);
  setTimeout(() => f.emit('onServiceDiscovered', ssdp), 5);
  setTimeout(() => f.emit('onServiceScanComplete', { mdnsCount: 0, ssdpCount: 1, cancelled: false }), 15);
  const bundle = await pending;
  assert.equal(bundle.ssdp.length, 1);
  assert.equal(bundle.cancelled, false);
  assert.equal(f.count(), 0);
});

test('discoverServices gives up waiting for a running discovery after its own window', async () => {
  const f = fake(() => Promise.reject(running));
  const bundle = await new TcpScanEngine(f.binding).discoverServices(30);
  assert.equal(bundle.cancelled, false);
  assert.equal(f.count(), 0);
});

test('discoverServices still fails on any other rejection', async () => {
  const f = fake(() => Promise.reject(new Error('React context unavailable')));
  await assert.rejects(new TcpScanEngine(f.binding).discoverServices(30), /React context/);
  assert.equal(f.count(), 0);
});
