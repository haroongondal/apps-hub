import test from 'node:test';
import assert from 'node:assert/strict';

import { hashNetworkId } from '../device-repository.ts';
import {
  DEFAULT_HOME_WATCH_SETTINGS,
  orderHomeWatch,
  type HomeNetworkRef,
  type HomeWatchSettings,
  type HomeWatchSnapshot,
  type HomeWatchStatus,
} from '../home-watch.ts';
import { createHomeWatchController, NO_ROUTER_ID, type HomeWatchContext } from '../home-watch-controller.ts';

const router = { routerId: 'uuid:r', routerUrl: 'http://192.168.1.1:5000/d.xml' };
const networkId = hashNetworkId('192.168.1.1', 24);
const iface = { localIp: '192.168.1.20', cidrPrefix: 24, gatewayIp: '192.168.1.1' };
const ctx = (over: Partial<HomeWatchContext> = {}): HomeWatchContext => ({
  iface, currentNetworkId: networkId, networkName: 'Flat 4', devices: [], readRouter: async () => router, ...over,
});
const phone = {
  id: 1, networkId, identityKey: 'k1', lastIp: '192.168.1.7', hostname: null, customName: null, vendorOrModel: null,
  openPortsCsv: '', mdnsServicesCsv: '', isTrusted: false, firstSeenAt: 1, lastSeenAt: 1, mdnsName: null, friendlyName: null,
  model: null, netbiosName: null, person: 'Sam', mac: null, isNew: false, seenThisScan: true,
};
const home: HomeNetworkRef = { networkId, gatewayIp: '192.168.1.1', label: 'Flat 4', ...router };
const on: HomeWatchSettings = { ...DEFAULT_HOME_WATCH_SETTINGS, whoIsHome: true, share: true, home };

// A fake of the native side: it keeps its own switches like the Kotlin store and holds every call until the test lets it go.
function fakeNative(initial: HomeWatchSettings, failing: Set<string> = new Set()) {
  let state = initial;
  const sent: Array<{ call: string; arg: unknown; snap: HomeWatchSnapshot | null }> = [];
  const gates: Array<() => void> = [];
  const status = (): HomeWatchStatus => ({ supported: true, settings: state, people: [], newDevices: [] });
  const held = (call: string, arg: unknown, snap: HomeWatchSnapshot | null, apply: () => void): Promise<HomeWatchStatus> => {
    sent.push({ call, arg, snap });
    return new Promise((resolve, reject) =>
      gates.push(() => {
        if (failing.has(call)) return reject(new Error(`${call} failed`));
        apply();
        resolve(status());
      }),
    );
  };
  const binding = {
    getHomeWatch: () => held('get', null, null, () => undefined),
    setHomeWatch: (s: HomeWatchSettings, snap: HomeWatchSnapshot | null) => held('set', s, snap, () => { state = s; }),
    syncHome: (h: HomeNetworkRef, snap: HomeWatchSnapshot) =>
      held('sync', h, snap, () => { if (state.home?.routerId === h.routerId) state = { ...state, home: h }; }),
    markDeviceMine: (ip: string) => held('mine', ip, null, () => undefined),
  };
  const tick = () => new Promise((r) => setImmediate(r));
  return { binding, sent, native: () => state, release: async () => { gates.shift()?.(); await tick(); }, tick };
}

function setup(initial: HomeWatchSettings, failing?: Set<string>) {
  const fake = fakeNative(initial, failing);
  const shown: HomeWatchStatus[] = [];
  const controller = createHomeWatchController(orderHomeWatch(fake.binding), {
    onStatus: (s) => shown.push(s),
    onNotificationsAllowed: () => undefined,
    notificationsGranted: async () => true,
  });
  const shareShown = () => shown.map((s) => (s.supported ? s.settings.share : null));
  return { fake, controller, shown, shareShown };
}

test('owner turns Share off while a post-scan sync is in flight: the sync answer never shows Share on again', async () => {
  const { fake, controller, shareShown } = setup(on);
  controller.apply({ supported: true, settings: on, people: [], newDevices: [] });
  const sync = controller.syncAfterScan(router, 'Flat 4', []);
  await fake.tick();
  const off = controller.update({ share: false }, ctx());
  await fake.tick();
  assert.deepEqual(fake.sent.map((c) => c.call), ['sync'], 'the save waits behind the sync');
  await fake.release();
  await fake.release();
  await Promise.all([sync, off]);
  assert.equal(await off, null);
  assert.equal(fake.sent[1].snap, null, 'a plain switch change sends no device list');
  assert.deepEqual(shareShown(), [true, false], 'the sync answer (Share on) was dropped');
  assert.equal(fake.native().share, false);
  assert.equal(controller.latestSettings()?.share, false);
});

test('the post-scan sync sends only the home and the device list, never a switch', async () => {
  const { fake, controller } = setup({ ...on, share: false });
  controller.apply({ supported: true, settings: { ...on, share: false }, people: [], newDevices: [] });
  const sync = controller.syncAfterScan(router, 'Flat 4', []);
  await fake.tick();
  assert.deepEqual(fake.sent, [{ call: 'sync', arg: home, snap: { people: [], known: [] } }]);
  assert.deepEqual(Object.keys(fake.sent[0].arg as object).sort(), ['gatewayIp', 'label', 'networkId', 'routerId', 'routerUrl']);
  await fake.release();
  await sync;
});

test('a save in flight does not bring Share back: the next save waits and builds on what the first one left', async () => {
  const { fake, controller, shown, shareShown } = setup({ ...DEFAULT_HOME_WATCH_SETTINGS });
  controller.apply({ supported: true, settings: { ...on, share: true }, people: [], newDevices: [] });
  const first = controller.update({ newDevices: true }, ctx());
  await fake.tick();
  const second = controller.update({ share: false }, ctx());
  await fake.tick();
  assert.deepEqual(fake.sent.map((c) => c.call), ['set'], 'the second save waits for the first');
  await fake.release();
  await fake.release();
  await Promise.all([first, second]);
  assert.deepEqual(fake.sent.map((c) => c.call), ['set', 'set']);
  assert.deepEqual(fake.sent[1].arg, { ...on, newDevices: true, share: false }, 'prev came from the latest ref (newDevices on, Share off)');
  assert.deepEqual(shareShown(), [true, true, false], 'the last answer shown is Share off');
  assert.equal(shown.length, 3);
  assert.equal(fake.native().share, false);
  assert.equal(fake.native().newDevices, true);
});

test('Share turned off while the permission dialog is open stays off', async () => {
  const fake = fakeNative(on);
  let answer: (granted: boolean) => void = () => undefined;
  const controller = createHomeWatchController(orderHomeWatch(fake.binding), {
    onStatus: () => undefined,
    onNotificationsAllowed: () => undefined,
    notificationsGranted: () => new Promise<boolean>((resolve) => (answer = resolve)),
  });
  controller.apply({ supported: true, settings: on, people: [], newDevices: [] });
  const first = controller.update({ newDevices: true }, ctx());
  await fake.tick();
  const off = controller.update({ share: false }, ctx());
  await fake.tick();
  answer(true);
  await fake.tick();
  await fake.release();
  await fake.release();
  assert.equal(await first, null);
  assert.equal(await off, null, 'each call resolves with its own outcome');
  assert.equal(fake.native().share, false, 'closing the dialog did not send Share on');
  assert.equal(fake.native().newDevices, true);
  assert.equal(controller.latestSettings()?.share, false);
});

test('a call is dropped only when a later call worked: a later failure leaves the earlier answer on screen', async () => {
  const { fake, controller, shown } = setup({ ...DEFAULT_HOME_WATCH_SETTINGS }, new Set(['sync']));
  controller.apply({ supported: true, settings: on, people: [], newDevices: [] });
  const save = controller.update({ newDevices: true }, ctx());
  await fake.tick();
  const sync = controller.syncAfterScan(router, 'Flat 4', []);
  await fake.release();
  await fake.release();
  assert.equal(await save, null);
  await sync;
  assert.equal(shown.length, 2, 'the save answer was shown, the failed sync added nothing');
  assert.equal(shown[1].supported && shown[1].settings.newDevices, true);
});

test('a save that fails puts back the switches from just before it, and a later sync cannot turn them on', async () => {
  const { fake, controller } = setup({ ...on, share: false }, new Set(['set']));
  controller.apply({ supported: true, settings: { ...on, share: false }, people: [], newDevices: [] });
  const save = controller.update({ share: true }, ctx());
  await fake.tick();
  assert.equal(controller.latestSettings()?.share, true, 'shown as on while it saves');
  await fake.release();
  assert.match((await save) ?? '', /could not save this setting: set failed/);
  assert.equal(controller.latestSettings()?.share, false);
  const sync = controller.syncAfterScan(router, 'Flat 4', []);
  await fake.tick();
  await fake.release();
  await sync;
  assert.deepEqual(fake.sent[fake.sent.length - 1].arg, home, 'the sync after a failed save still sends only the home');
});

test('with both switches off no sync is sent, and turning them off drops the home', async () => {
  const { fake, controller } = setup(on);
  controller.apply({ supported: true, settings: on, people: [], newDevices: [] });
  const off = controller.update({ whoIsHome: false, newDevices: false }, ctx());
  await fake.tick();
  await fake.release();
  await off;
  assert.equal(fake.native().home, null);
  await controller.syncAfterScan(router, 'Flat 4', []);
  assert.deepEqual(fake.sent.map((c) => c.call), ['set'], 'nothing was sent for the sync');
});

test('turning the first switch on needs the home Wi-Fi and a router ID, and then pins the home with the device list', async () => {
  const { fake, controller } = setup({ ...DEFAULT_HOME_WATCH_SETTINGS });
  assert.match((await controller.update({ whoIsHome: true }, ctx({ currentNetworkId: 'other' }))) ?? '', /home Wi-Fi first/);
  assert.equal(await controller.update({ whoIsHome: true }, ctx({ readRouter: async () => null })), NO_ROUTER_ID);
  assert.equal(fake.sent.length, 0, 'nothing was saved');
  const save = controller.update({ whoIsHome: true }, ctx({ devices: [phone] }));
  await fake.tick();
  await fake.release();
  assert.equal(await save, null);
  assert.deepEqual(fake.native(), { ...DEFAULT_HOME_WATCH_SETTINGS, whoIsHome: true, home });
  assert.deepEqual(fake.sent[0].snap?.known.map((k) => k.ip), ['192.168.1.7'], 'the pinning save sends the device list');
});
