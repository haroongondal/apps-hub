import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T, plural } from '../dl-text.ts';

const PLAIN: Record<string, string> = {
  listTitle: 'Sieve downloads',
  navAll: 'All downloads',
  navUnfinished: 'Unfinished',
  navFinished: 'Finished',
  navCategories: 'Categories',
  navQueues: 'Queues',
  addUrl: 'Add URL',
  resume: 'Resume',
  pause: 'Pause',
  delete: 'Delete',
  speedLimit: 'Speed limit',
  scheduler: 'Scheduler',
  colName: 'Name',
  colSize: 'Size',
  colProgress: 'Progress',
  colSpeed: 'Speed',
  colEta: 'Time left',
  emptyAll: 'No downloads yet. Press Add URL, or download a large file in Chrome.',
  emptyFiltered: 'Nothing here.',
  offBanner: "Downloads are off. Sieve isn't taking over Chrome's downloads or starting queued ones. You can still resume or remove what's listed here.",
  turnOn: 'Turn on',
  retryInChrome: 'Retry in Chrome',
  showInFolder: 'Show in folder',
  confirmDelete: 'Delete',
  confirmRemove: 'Remove from list',
  cancel: 'Cancel',
  addTitle: 'Add downloads',
  addLabel: 'Web addresses (one per line)',
  addQueue: 'Queue',
  addCategory: 'Save in',
  addAutomatic: 'Automatic',
  addSubmit: 'Add',
  addNone: 'Enter at least one web address that starts with http:// or https://.',
  addTooMany: 'You can add up to 500 web addresses at a time. Remove some lines, then try again.',
  addFailed: "Sieve couldn't add these downloads. Reload Sieve from chrome://extensions, then try again.",
  actionFailed: "Sieve couldn't do that. Reload Sieve from chrome://extensions, then try again.",
  retryGone: 'This download is no longer in the list.',
  retryRefused: "Chrome didn't start the download. Check your connection, then try again.",
  navLabel: 'Download filters',
  limitOn: 'Limit download speed',
  limitValue: 'Limit (KB/s)',
  limitNote: 'The limit applies to all downloads together.',
  schedulerTitle: 'Scheduler',
  scheduleUse: 'Use this schedule',
  scheduleStart: 'Start at',
  scheduleStop: 'Stop at',
  scheduleNoStop: 'Run until midnight',
  scheduleParallel: 'Downloads at once',
  close: 'Close',
  menuOn: 'Downloads on',
  menuOff: "Downloads are off. Sieve won't take over Chrome's downloads.",
  menuNone: 'No downloads right now.',
  menuSeeAll: 'Open download list',
  menuAdd: 'Add URL',
  ctxLink: 'Download link with Sieve',
  ctxSelection: 'Download selected links with Sieve',
  ctxPage: 'Download all links with Sieve',
  sectionTitle: 'Downloads',
  setOn: 'Downloads',
  setOnHelp: "Turn this off to stop taking over Chrome's downloads, the right-click items and queue starts. Your list stays.",
  setTakeOver: "Take over Chrome's downloads",
  setMinMb: 'Smallest file to take over (MB)',
  setExtensions: 'File types to take over',
  setExtensionsHelp: 'Extensions, separated by spaces or commas.',
  setMime: 'Content types to take over',
  setMimeHelp: 'One per line. End with * to match a whole family, like video/*.',
  setResetTypes: 'Reset file types',
  setParts: 'Parts per file',
  setPartsHelp: 'One part is the safest. More parts can help when a server limits each connection, but they often change nothing and some servers refuse them. If a server refuses, Sieve uses fewer parts for that site for 30 minutes.',
  setSpeed: 'Speed limit',
  setCategories: 'Categories',
  setCategoriesHelp: 'Each category is a folder inside your Downloads folder.',
  setQueues: 'Queues',
  setQueueName: 'Queue name',
  setAddQueue: 'Add a queue',
};
const ST_PLAIN: Record<string, string> = {
  starting: 'Starting',
  downloading: 'Downloading',
  paused: 'Paused',
  saving: 'Saving to Downloads',
  failed: 'Failed',
  noResume: "This server can't resume a download, so Sieve downloads it in one go.",
};
const TEMPLATES = ['selectRow', 'progressLabel', 'confirmDeleteUnfinished', 'confirmDeleteFinished', 'addSkipped', 'setFolder', 'setCategoryExt', 'setRemoveQueue'];

test('every table key exists with the exact text', () => {
  for (const [k, v] of Object.entries(PLAIN)) assert.equal((T as Record<string, unknown>)[k], v, k);
  for (const [k, v] of Object.entries(ST_PLAIN)) assert.equal((T.st as Record<string, unknown>)[k], v, `st.${k}`);
  assert.deepEqual(T.days, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  assert.deepEqual(T.categoryNames, { video: 'Video', music: 'Music', programs: 'Programs', archives: 'Archives', documents: 'Documents', other: 'Other' });
  assert.equal(T.selectRow('a.zip'), 'Select a.zip');
  assert.equal(T.progressLabel('a.zip'), 'Progress of a.zip');
  assert.equal(T.setFolder('Video'), 'Folder for Video');
  assert.equal(T.setCategoryExt('Video'), 'File types for Video');
  assert.equal(T.setRemoveQueue('Night'), 'Remove Night');
  assert.equal(T.st.waiting('Main queue'), 'Waiting in Main queue');
  assert.equal(T.st.scheduled('Tue 22:00'), 'Scheduled for Tue 22:00');
  assert.equal(T.st.done('Movies'), 'Saved to Downloads/Movies');
  const expectedKeys = [...Object.keys(PLAIN), ...TEMPLATES, 'days', 'categoryNames', 'st'].sort();
  assert.deepEqual(Object.keys(T).sort(), expectedKeys);
  assert.deepEqual(Object.keys(T.st).sort(), [...Object.keys(ST_PLAIN), 'waiting', 'scheduled', 'done'].sort());
});

test('plural from dl-text', () => {
  assert.equal(plural(1, 'download', 'downloads'), '1 download');
  assert.equal(plural(1234, 'download', 'downloads'), '1,234 downloads');
  assert.equal(plural(0, 'download', 'downloads'), '0 downloads');
});

function strings(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') for (const a of [1, 2, 3]) out.push(String((v as (x: unknown) => unknown)(a === 1 ? 'Sample' : a)));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(T);
  return out;
}

test('no speed-up wording, no emoji, no ALL-CAPS, plain strings start uppercase or digit', () => {
  const all = strings();
  assert.ok(all.length > 100);
  for (const s of all) {
    assert.doesNotMatch(s, /faster|accelerat|boost|turbo|speed up/i, s);
    assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, s);
    assert.doesNotMatch(s, /\b[A-Z]{4,}\b/, s);
  }
  const plain: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') plain.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(T);
  for (const s of plain) assert.match(s, /^[\p{Lu}\d]/u, s);
});

test('addSkipped and confirmDelete templates', () => {
  assert.equal(T.addSkipped(1), "1 line isn't a web address and was skipped.");
  assert.equal(T.addSkipped(3), "3 lines aren't web addresses and were skipped.");
  assert.equal(T.confirmDeleteUnfinished(2), 'Delete 2 downloads? Sieve removes the partly downloaded data.');
  assert.equal(T.confirmDeleteFinished(1), 'Remove 1 download from the list? The saved files stay in your Downloads folder.');
});
