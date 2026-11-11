import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { newRecord, type DlRecord, type DlState } from '@apps-hub/sieve-core/src/dl-record.ts';
import { DEFAULT_DOWNLOADS, validateDownloadSettings, type DownloadSettings, type Schedule } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { nextChange } from '@apps-hub/sieve-core/src/dl-queue.ts';
import { ALARM_SCHEDULE, ALARM_WATCHDOG, runnable, syncAlarms } from '../dl/alarms.ts';

const BASE = 'chrome-extension://sieve/';
type Listener = (message: unknown, sender: unknown, reply: (r: unknown) => void) => boolean;
type Router = typeof import('../dl/router.ts');

let n = 0;
let ids = 0;
const rec = (state: DlState, extra: Partial<DlRecord> = {}): DlRecord => ({
  ...newRecord({ url: 'https://example.com/a.zip', referrer: '', name: 'a.zip', category: 'archives', categoryFixed: false, queue: 'main', source: 'manual', partsWanted: 1 }, 1000 + ids, 'r' + ++ids),
  state,
  ...extra,
});
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const hoursAhead = (h: number) => new Date(Date.now() + h * 3_600_000);
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const later = (): Schedule => ({ on: true, days: ALL_DAYS, start: hhmm(hoursAhead(2)), stop: hhmm(hoursAhead(3)) });
const withQueue = (schedule: Schedule, extra: Partial<DownloadSettings> = {}): DownloadSettings => ({
  ...DEFAULT_DOWNLOADS,
  ...extra,
  queues: [{ ...DEFAULT_DOWNLOADS.queues[0], schedule }],
});

// An in-memory chrome (storage with change listeners, alarms, a runtime whose sendMessage the test scripts, an offscreen API that counts documents)
// and a fresh copy of router.ts whose record reader and rule sync are fakes.
async function boot(options: { records?: DlRecord[]; settings?: DownloadSettings; documents?: number; createSlow?: boolean } = {}) {
  const t = {
    records: options.records ?? [],
    documents: options.documents ?? 0,
    created: 0,
    closed: 0,
    send: [] as { type?: string }[],
    alarms: new Map<string, { periodInMinutes?: number; when?: number }>(),
    syncs: 0,
    extras: [] as unknown[],
    concurrent: 0,
    maxConcurrent: 0,
    store: new Map<string, unknown>(),
    onMessage: [] as Listener[],
    onAlarm: [] as ((a: { name: string }) => void)[],
    onChanged: [] as ((c: Record<string, { newValue?: unknown }>, area: string) => void)[],
  };
  if (options.settings) t.store.set('downloads', options.settings);
  const g = globalThis as unknown as Record<string, unknown>;
  g.chrome = {
    storage: {
      local: { get: async (k: string) => (t.store.has(k) ? { [k]: structuredClone(t.store.get(k)) } : {}), set: async (o: Record<string, unknown>) => void Object.entries(o).forEach(([k, v]) => t.store.set(k, v)) },
      onChanged: { addListener: (cb: (typeof t.onChanged)[number]) => void t.onChanged.push(cb) },
    },
    alarms: {
      onAlarm: { addListener: (cb: (typeof t.onAlarm)[number]) => void t.onAlarm.push(cb) },
      create: async (name: string, info: { periodInMinutes?: number; when?: number }) => void t.alarms.set(name, info),
      clear: async (name: string) => t.alarms.delete(name),
    },
    runtime: {
      getURL: (p: string) => BASE + p,
      getContexts: async () => Array.from({ length: t.documents }, () => ({})),
      sendMessage: async (m: { type?: string }) => (t.send.push(m), m.type === 'dl-eng-add' ? { ids: ['x'] } : { ok: true }),
      onMessage: { addListener: (cb: Listener) => void t.onMessage.push(cb) },
    },
    declarativeNetRequest: { updateSessionRules: async () => {} },
    offscreen: {
      createDocument: async () => {
        t.concurrent++;
        t.maxConcurrent = Math.max(t.maxConcurrent, t.concurrent);
        if (options.createSlow) await sleep(15);
        t.documents++;
        t.created++;
        t.concurrent--;
      },
      closeDocument: async () => {
        t.documents--;
        t.closed++;
      },
    },
  };
  console.error = () => {};
  const router = await (import(`../dl/router.ts?fresh=${++n}`) as Promise<Router>);
  router.io.records = async () => t.records;
  router.io.syncRules = async (extra) => void (t.syncs++, t.extras.push(extra));
  router.io.dropRules = () => {};
  router.initRouter();
  await router.reconcile(); // the start-up reconcile and this one have both finished
  const zero = () => {
    t.created = t.closed = t.syncs = 0;
    t.send.length = 0;
    t.extras.length = 0;
  };
  zero();
  const post = (message: unknown, url = BASE + 'offscreen.html') =>
    new Promise<{ keepsOpen: boolean; reply?: unknown }>((resolve) => {
      const keepsOpen = t.onMessage[0](message, { url }, (reply) => resolve({ keepsOpen, reply }));
      if (!keepsOpen) resolve({ keepsOpen });
    });
  return { ...t, t, router, post, zero };
}

test('reconcile creates the engine only for work: a queued record in an open queue, or a saving one', async () => {
  const queued = await boot({ records: [rec('queued')] });
  assert.equal(queued.t.documents, 1);

  const saving = await boot({ records: [rec('saving')] });
  assert.equal(saving.t.documents, 1);
});

test('reconcile creates no engine for no records, done, paused or failed records, a queued record in a closed window, or downloads off', async () => {
  const closed = withQueue(later());
  for (const [records, settings] of [
    [[], undefined],
    [[rec('done'), rec('paused'), rec('failed')], undefined],
    [[rec('queued')], closed],
    [[rec('queued')], { ...DEFAULT_DOWNLOADS, on: false }],
  ] as [DlRecord[], DownloadSettings | undefined][]) {
    const t = await boot({ records, settings });
    await t.router.reconcile();
    assert.equal(t.t.documents, 0, JSON.stringify({ records: records.map((r) => r.state), on: settings?.on }));
  }
});

test('reconcile with downloads off creates the engine for a forced queued record', async () => {
  const t = await boot({ records: [rec('queued', { force: true })], settings: { ...DEFAULT_DOWNLOADS, on: false } });
  assert.equal(t.t.documents, 1);
});

test('reconcile syncs the session rules every time it runs', async () => {
  const t = await boot();
  await t.router.reconcile();
  await t.router.reconcile();
  assert.equal(t.t.syncs, 2);
});

test('alarms: runnable work creates dl-watchdog every minute; no work clears it; a queued record in a closed window gets none', async () => {
  const running = await boot({ records: [rec('running')] });
  assert.deepEqual(running.alarms.get(ALARM_WATCHDOG), { periodInMinutes: 1 });
  running.t.records = [rec('done')];
  await running.router.reconcile();
  assert.equal(running.alarms.has(ALARM_WATCHDOG), false);
  const closed = await boot({ records: [rec('queued')], settings: withQueue(later()) });
  assert.equal(closed.alarms.has(ALARM_WATCHDOG), false);
  assert.equal(runnable([rec('queued')], withQueue(later()), new Date()), false);
});

test('alarms: a queued record in a schedule queue creates dl-schedule at the next change; a running non-forced one too', async () => {
  const s = later();
  for (const state of ['queued', 'running'] as const) {
    const t = await boot({ records: [rec(state)], settings: withQueue(s) });
    assert.equal(t.alarms.get(ALARM_SCHEDULE)?.when, nextChange(s, new Date()), state);
  }
});

test('alarms: dl-schedule is at least one second ahead, and is cleared without a schedule or with only paused, failed, done or forced records', async () => {
  const at = new Date(2026, 10, 11, 10, 59, 59, 500);
  const s: Schedule = { on: true, days: ALL_DAYS, start: '11:00', stop: '12:00' };
  const created: unknown[] = [];
  const cleared: string[] = [];
  (globalThis as unknown as Record<string, unknown>).chrome = { alarms: { create: async (name: string, info: unknown) => void created.push([name, info]), clear: async (name: string) => void cleared.push(name) } };
  await syncAlarms([rec('queued')], withQueue(s), at);
  assert.deepEqual(created.find((c) => (c as string[])[0] === ALARM_SCHEDULE), [ALARM_SCHEDULE, { when: at.getTime() + 1000 }]);

  const quiet: DlRecord[][] = [[], [rec('paused'), rec('failed'), rec('done')], [rec('queued', { force: true }), rec('running', { force: true })]];
  for (const records of quiet) {
    cleared.length = 0;
    await syncAlarms(records, withQueue(s), at);
    assert.ok(cleared.includes(ALARM_SCHEDULE), JSON.stringify(records.map((r) => r.state)));
  }
  cleared.length = 0;
  await syncAlarms([rec('queued')], DEFAULT_DOWNLOADS, at);
  assert.ok(cleared.includes(ALARM_SCHEDULE), 'a schedule that is off has no next change');
});

test('alarm handlers: both alarms send dl-eng-tick when the engine exists and not when it does not', async () => {
  for (const name of [ALARM_WATCHDOG, ALARM_SCHEDULE]) {
    const withEngine = await boot({ documents: 1 });
    withEngine.onAlarm[0]({ name });
    await sleep(30);
    assert.deepEqual(withEngine.send, [{ type: 'dl-eng-tick' }], name);
    const without = await boot();
    without.onAlarm[0]({ name });
    await sleep(30);
    assert.deepEqual(without.send, [], name);
    assert.equal(without.t.documents, 0);
  }
});

test('alarm handlers: dl-watchdog recreates a missing engine when work is runnable; another alarm does nothing', async () => {
  const t = await boot({ records: [rec('running')] });
  t.t.documents = 0;
  t.zero();
  t.onAlarm[0]({ name: 'other' });
  await sleep(20);
  assert.equal(t.t.documents, 0);
  t.onAlarm[0]({ name: ALARM_WATCHDOG });
  await sleep(30);
  assert.equal(t.t.documents, 1);
  assert.equal(t.t.created, 1);
});

test('settings push: a downloads change sends dl-eng-config with the validated settings when the engine exists', async () => {
  const t = await boot({ documents: 1 });
  t.onChanged[0]({ downloads: { newValue: { ...DEFAULT_DOWNLOADS, parts: 4 } } }, 'local');
  await sleep(30);
  assert.deepEqual(t.send, [{ type: 'dl-eng-config', settings: validateDownloadSettings({ ...DEFAULT_DOWNLOADS, parts: 4 }) }]);
  assert.equal(t.t.syncs, 1, 'a reconcile followed');
});

test('settings push: nothing is sent and no engine is created when there is none; other keys and areas are ignored', async () => {
  const t = await boot();
  t.onChanged[0]({ downloads: { newValue: { ...DEFAULT_DOWNLOADS, parts: 4 } } }, 'local');
  t.onChanged[0]({ settings: { newValue: {} } }, 'local');
  t.onChanged[0]({ downloads: { newValue: {} } }, 'sync');
  await sleep(30);
  assert.deepEqual(t.send, []);
  assert.equal(t.t.created, 0);
});

const stateMsg = (records: Partial<DlRecord>[], removed: string[] = []) => ({ type: 'dl-state', records, removed, speeds: {}, total: 0 });

test('dl-state: five messages inside one second that each carry a new state cause one reconcile', async () => {
  const t = await boot();
  for (let i = 0; i < 5; i++) {
    const r = await t.post(stateMsg([rec('running', { id: 'x' + i })]));
    assert.equal(r.keepsOpen, false);
  }
  assert.equal(t.t.syncs, 0, 'nothing runs before the debounce ends');
  await sleep(1300);
  assert.equal(t.t.syncs, 1);
});

test('dl-state: a hundred progress-only messages cause no reconcile; a state change after them causes one', async () => {
  const t = await boot();
  const r = rec('running', { id: 'p' });
  await t.post(stateMsg([r]));
  await sleep(1300);
  t.zero();
  for (let i = 0; i < 100; i++) await t.post(stateMsg([{ ...r, parts: [{ start: 0, end: 9, done: i }] }]));
  await sleep(1300);
  assert.equal(t.t.syncs, 0);
  await t.post(stateMsg([{ ...r, state: 'saving' }]));
  await sleep(1300);
  assert.equal(t.t.syncs, 1);
});

test('dl-state: a removed id causes one reconcile', async () => {
  const t = await boot();
  await t.post(stateMsg([], ['x']));
  await sleep(1300);
  assert.equal(t.t.syncs, 1);
});

test('dl-state: a record whose finalUrl changes syncs the session rules at once, with no state change and without waiting for the debounce (O2)', async () => {
  const t = await boot();
  const r = rec('running', { id: 'f', referrer: 'https://example.com/page' });
  await t.post(stateMsg([r]));
  await sleep(1300);
  t.zero();
  await t.post(stateMsg([{ ...r, finalUrl: 'https://cdn.example.com/a.zip' }]));
  await sleep(100);
  assert.equal(t.t.syncs, 1);
  assert.deepEqual(t.t.extras, [[{ url: 'https://cdn.example.com/a.zip', referrer: 'https://example.com/page' }]], 'the stored record has no final address yet, so the broadcast supplies it');
  await sleep(1300);
  assert.equal(t.t.syncs, 1, 'the unchanged state adds no second sync');
  t.t.records = [{ ...r, finalUrl: 'https://cdn.example.com/a.zip' }];
  t.zero();
  await t.router.reconcile();
  assert.deepEqual(t.t.extras, [[]], 'once the store has the final address the broadcast adds nothing');
});

test('dl-state: a first sighting of a record that already has a different finalUrl syncs the rules too; a web page sender is ignored', async () => {
  const t = await boot();
  await t.post(stateMsg([rec('running', { id: 'g', finalUrl: 'https://cdn.example.com/a.zip' })]));
  await sleep(100);
  assert.equal(t.t.syncs, 1);
  const web = await t.post(stateMsg([rec('queued', { id: 'h' })], ['z']), 'https://example.com/');
  assert.equal(web.keepsOpen, false);
  await sleep(1300);
  assert.equal(t.t.syncs, 2, 'the page message added nothing; only the first message and its state debounce ran');
});

test('dl-sw-idle closes the document when nothing is runnable and replies ok', async () => {
  const t = await boot({ documents: 1, records: [rec('done')] });
  assert.deepEqual((await t.post({ type: 'dl-sw-idle' })).reply, { ok: true });
  assert.equal(t.t.closed, 1);
  assert.equal(t.t.documents, 0);
});

test('dl-sw-idle leaves the document when a queued record in an open queue, a running or a saving record exists, and replies ok', async () => {
  for (const state of ['queued', 'running', 'saving'] as const) {
    const t = await boot({ documents: 1, records: [rec(state)] });
    assert.deepEqual((await t.post({ type: 'dl-sw-idle' })).reply, { ok: true }, state);
    assert.equal(t.t.closed, 0, state);
  }
});

test('dl-sw-idle closes the document for a queued record in a closed window', async () => {
  const t = await boot({ documents: 1, records: [rec('queued')], settings: withQueue(later()) });
  await t.post({ type: 'dl-sw-idle' });
  assert.equal(t.t.closed, 1);
});

test('dl-add calls reconcile after a successful add and not after a refused one', async () => {
  const t = await boot({ documents: 1 });
  await t.post({ type: 'dl-add', items: [{ url: 'https://example.com/a.zip', source: 'manual' }] });
  await sleep(30);
  assert.equal(t.t.syncs, 1);
  t.zero();
  await t.post({ type: 'dl-add', items: [{ url: 'ftp://x/y', source: 'manual' }] });
  await sleep(30);
  assert.equal(t.t.syncs, 0);
});

test('serialisation: two reconcile calls started together never run ensureEngine concurrently', async () => {
  const t = await boot({ records: [rec('running')], createSlow: true });
  t.t.documents = 0;
  await Promise.all([t.router.reconcile(), t.router.reconcile(), t.router.reconcile()]);
  assert.equal(t.t.maxConcurrent, 1);
  assert.equal(t.t.documents, 1);
});
