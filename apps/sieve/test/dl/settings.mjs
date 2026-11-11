import { isDeepStrictEqual as same } from 'node:util';
import { DEFAULT_DOWNLOADS, DEFAULT_TAKEOVER_EXTENSIONS, DEFAULT_TAKEOVER_MIME_TYPES, validateDownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { T } from '@apps-hub/sieve-core/src/dl-text.ts';
import { extPage, localGet, readRecords, resetDl, sendMsg, setDownloads, until } from './_helpers.mjs';

const json = (v) => String(JSON.stringify(v)).slice(0, 500);
const stored = async (t) => validateDownloadSettings((await localGet(t, 'downloads')).downloads);

export async function run(t) {
  if (!t.fx) return t.check('downloads: settings needs the fixture server', false);
  const { check, fx } = t;
  const errorsBefore = t.errors.length;
  await resetDl(t);
  const page = await extPage(t, 'options.html');
  const sec = page.locator('#downloads');
  const by = (text) => sec.getByLabel(text, { exact: true });
  await sec.waitFor();
  const attempt = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      check(`downloads: settings: ${name}`, false, String(e?.message ?? e).slice(0, 400));
    }
  };
  const setField = async (loc, value) => {
    await loc.fill(String(value));
    await loc.blur();
  };
  const D = DEFAULT_DOWNLOADS;
  const ok = (fn) => until(fn, 5000).then(() => true, () => false);

  await attempt('rendering', async () => {
    await until(async () => (await by(T.setMinMb).inputValue()) === '5');
    const heading = await sec.locator('h2').first().innerText();
    const reachable = [T.setOn, T.setTakeOver, T.setMinMb, T.setExtensions, T.setMime, T.setParts, T.limitOn, T.limitValue, T.setQueueName];
    const missing = [];
    for (const l of reachable) if ((await by(l).count()) === 0) missing.push(l);
    for (const b of [T.setResetTypes, T.setAddQueue]) if ((await sec.getByRole('button', { name: b, exact: true }).count()) === 0) missing.push(b);
    check('downloads: settings: the heading is the section title and every control is reachable by its label', heading === T.sectionTitle && missing.length === 0, json({ heading, missing }));
    const got = {
      on: await by(T.setOn).isChecked(),
      takeOver: await by(T.setTakeOver).isChecked(),
      minMb: await by(T.setMinMb).inputValue(),
      parts: await by(T.setParts).inputValue(),
      limitOn: await by(T.limitOn).isChecked(),
      limit: await by(T.limitValue).inputValue(),
      extensions: (await by(T.setExtensions).inputValue()).split(/\s+/).filter(Boolean).length,
      mime: (await by(T.setMime).inputValue()).split('\n').filter(Boolean).length,
      folders: await sec.getByLabel(/^Folder for /).count(),
    };
    check(
      'downloads: settings: the defaults match DEFAULT_DOWNLOADS (5 MB, 1 part, limit off at 1000, 56 types, 31 content types, six folders)',
      same(got, { on: true, takeOver: true, minMb: '5', parts: '1', limitOn: false, limit: '1000', extensions: 56, mime: 31, folders: 6 }) && D.takeOver.minMb === 5,
      json(got),
    );
  });

  await attempt('writes and clamps', async () => {
    await setField(by(T.setMinMb), 7.6);
    check('downloads: settings: 7.6 MB is stored as 8', await ok(async () => (await stored(t)).takeOver.minMb === 8 && (await by(T.setMinMb).inputValue()) === '8'));
    await setField(by(T.setMinMb), 1e9);
    check('downloads: settings: 1e9 MB is stored as 100000 and shown so', await ok(async () => (await stored(t)).takeOver.minMb === 100000 && (await by(T.setMinMb).inputValue()) === '100000'));
    await setField(by(T.setParts), 9);
    check('downloads: settings: 9 parts is stored as 6 and the input shows 6', await ok(async () => (await stored(t)).parts === 6 && (await by(T.setParts).inputValue()) === '6'));
    await setField(by(T.limitValue), 5);
    check('downloads: settings: a limit of 5 KB/s is stored as 10', await ok(async () => (await stored(t)).speedLimit.kbPerSecond === 10 && (await by(T.limitValue).inputValue()) === '10'));
    const video = by(T.setFolder(T.categoryNames.video));
    await setField(video, 'a/b');
    check('downloads: settings: the folder a/b is stored as the default folder and the input shows it', await ok(async () => (await stored(t)).categories[0].folder === 'Video' && (await video.inputValue()) === 'Video'));
    await setField(video, 'Clips');
    check('downloads: settings: the folder Clips is stored', await ok(async () => (await stored(t)).categories[0].folder === 'Clips' && (await video.inputValue()) === 'Clips'));
    const music = by(T.setCategoryExt(T.categoryNames.music));
    await setField(music, 'MP3 .flac nope!');
    check('downloads: settings: category types are split, cleaned and shown back', await ok(async () => same((await stored(t)).categories[1].extensions, ['mp3', 'flac']) && (await music.inputValue()) === 'mp3 flac'));
    check('downloads: settings: the Other category has no types box', await ok(async () => (await by(T.setCategoryExt(T.categoryNames.other)).count()) === 0));
    await resetDl(t);
    await until(async () => (await by(T.setParts).inputValue()) === '1');
  });

  await attempt('lists', async () => {
    // `x` is a valid extension, so the last word is one the validator rejects.
    await setField(by(T.setExtensions), '.MP4, mkv bad! no-way');
    check('downloads: settings: the extensions box stores mp4 and mkv only and then shows them', await ok(async () => same((await stored(t)).takeOver.extensions, ['mp4', 'mkv']) && (await by(T.setExtensions).inputValue()) === 'mp4 mkv'));
    await setField(by(T.setMime), 'Video/*\nbad');
    check('downloads: settings: the content types box stores video/* only', await ok(async () => same((await stored(t)).takeOver.mimeTypes, ['video/*']) && (await by(T.setMime).inputValue()) === 'video/*'));
    await sec.getByRole('button', { name: T.setResetTypes, exact: true }).click();
    const back = await until(async () => {
      const s = await stored(t);
      return same(s.takeOver.extensions, [...DEFAULT_TAKEOVER_EXTENSIONS]) && same(s.takeOver.mimeTypes, [...DEFAULT_TAKEOVER_MIME_TYPES]);
    }).catch(() => false);
    const shown = await until(async () => (await by(T.setExtensions).inputValue()).split(' ').length === 56).catch(() => false);
    check('downloads: settings: Reset file types restores both defaults and the box shows them', back === true && shown === true, json({ back, shown }));
  });

  await attempt('take-over rules apply', async () => {
    fx.reset();
    await resetDl(t);
    await until(async () => (await by(T.setMinMb).inputValue()) === '5');
    await setField(by(T.setMinMb), 1);
    await setField(by(T.setExtensions), 'zip');
    // Octet-stream is in the default content types and would take the .rar too; only the extension rule is under test.
    await setField(by(T.setMime), 'video/*');
    await until(async () => same((await stored(t)).takeOver.extensions, ['zip']));
    // A 2 MB file at full speed finishes before Chrome's item can be paused, so both are slowed to two seconds.
    const open = async (name) => {
      const p = await t.ctx.newPage();
      await p.goto(`${fx.base}/page?to=${encodeURIComponent(`/file/2000000/${name}?rate=1000000`)}`).catch(() => {});
      return p;
    };
    const z = await open('s.zip');
    const r = await until(async () => (await readRecords(t)).find((x) => x.url.includes('/s.zip')), 15000).catch(() => null);
    const q = await open('s.rar');
    const chromeDone = await until(async () => (await page.evaluate(() => chrome.downloads.search({}))).some((i) => i.url.includes('/s.rar') && i.state === 'complete'), 20000).catch(() => false);
    const rar = (await readRecords(t)).find((x) => x.url.includes('/s.rar'));
    check('downloads: settings: with 1 MB and the type zip, a 2 MB .zip is taken over and a 2 MB .rar is not', r?.source === 'takeover' && chromeDone === true && !rar, json({ zip: r?.source, chromeDone, rar: !!rar }));
    await z.close();
    await q.close();
    await page.evaluate(() => chrome.downloads.erase({}));
  });

  await attempt('parts', async () => {
    fx.reset();
    await resetDl(t);
    await until(async () => (await by(T.setParts).inputValue()) === '1');
    const text = await sec.innerText();
    check('downloads: settings: the parts help is on screen and never says faster or boost', text.includes(T.setPartsHelp) && !/faster|boost/i.test(text));
    await setField(by(T.setParts), 3);
    const reply = await sendMsg(t, { type: 'dl-add', items: [{ source: 'manual', url: `${fx.base}/file/30000000/p.bin?rate=15000000` }] });
    await until(async () => fx.log.filter((l) => l.path === '/file/30000000/p.bin' && l.range && l.range !== 'bytes=0-0').length >= 3, 15000).catch(() => {});
    const ranged = fx.log.filter((l) => l.path === '/file/30000000/p.bin' && l.range && l.range !== 'bytes=0-0');
    check('downloads: settings: 3 parts make three ranged connections for a new 30 MB download', reply?.ok === true && ranged.length === 3, json({ reply, ranged: ranged.map((l) => l.range) }));
    await sendMsg(t, { type: 'dl-do', op: 'remove', ids: reply?.ids ?? [] });
  });

  await attempt('switch', async () => {
    await resetDl(t);
    await until(async () => (await by(T.setOn).isChecked()) === true);
    await by(T.setOn).uncheck();
    const off = await until(async () => (await stored(t)).on === false).catch(() => false);
    const list = await extPage(t, 'downloads.html');
    const shown = await list.getByText(T.offBanner, { exact: true }).isVisible().catch(() => false);
    check('downloads: settings: turning Downloads off stores on: false and the list page shows the banner', off === true && shown, json({ off, shown }));
    await list.close();
    await by(T.setOn).check();
    await until(async () => (await stored(t)).on === true);
  });

  await attempt('two writers', async () => {
    await resetDl(t);
    const other = await extPage(t, 'options.html');
    const osec = other.locator('#downloads');
    await osec.getByLabel(T.setParts, { exact: true }).waitFor();
    await Promise.all([setField(by(T.setMinMb), 9), setField(osec.getByLabel(T.setParts, { exact: true }), 4)]);
    const both = await until(async () => {
      const s = await stored(t);
      return s.takeOver.minMb === 9 && s.parts === 4;
    }).catch(() => false);
    const seen = await until(async () => (await by(T.setParts).inputValue()) === '4' && (await osec.getByLabel(T.setMinMb, { exact: true }).inputValue()) === '9').catch(() => false);
    check('downloads: settings: two pages changing different fields at once both land and both pages show both', both === true && seen === true, json(await stored(t)));

    await by(T.setParts).focus();
    const s = await stored(t);
    await setDownloads(t, { takeOver: { ...s.takeOver, minMb: 42 } });
    const followed = await until(async () => (await by(T.setMinMb).inputValue()) === '42').catch(() => false);
    check('downloads: settings: a worker change updates another control while one has focus', followed === true && (await by(T.setParts).evaluate((el) => el === document.activeElement)));

    await by(T.setExtensions).fill('abc');
    await setDownloads(t, { takeOver: { ...s.takeOver, minMb: 43, extensions: ['zip'] } });
    await until(async () => (await by(T.setMinMb).inputValue()) === '43').catch(() => {});
    check('downloads: settings: a textarea being edited is not overwritten', (await by(T.setExtensions).inputValue()) === 'abc');
    await by(T.setExtensions).blur();
    await other.close();
  });

  await attempt('queues', async () => {
    await resetDl(t);
    await until(async () => (await by(T.setParts).inputValue()) === '1');
    await sec.getByRole('button', { name: T.setAddQueue, exact: true }).click();
    const added = await until(async () => (await stored(t)).queues.length === 2).catch(() => false);
    await setField(sec.getByLabel(T.setQueueName, { exact: true }).nth(1), 'Night');
    const renamed = await until(async () => (await stored(t)).queues[1]?.name === 'Night').catch(() => false);
    await sec.getByRole('button', { name: T.setRemoveQueue('Night'), exact: true }).click();
    const removed = await until(async () => (await stored(t)).queues.length === 1).catch(() => false);
    check('downloads: settings: the queue editor adds, renames and removes a queue', added === true && renamed === true && removed === true, json({ added, renamed, removed }));
  });

  await attempt('layout and screenshots', async () => {
    await resetDl(t);
    await until(async () => (await by(T.setParts).inputValue()) === '1');
    const width = await sec.evaluate((el) => ({ box: el.getBoundingClientRect().width, scroll: el.scrollWidth, page: document.documentElement.scrollWidth, vw: innerWidth }));
    check('downloads: settings: the section stays within the 720 px column', width.box <= 720 && width.scroll <= Math.ceil(width.box) && width.page <= width.vw, json(width));
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: `${t.shots}/settings-downloads-${scheme}.png`, fullPage: true });
    }
    await page.emulateMedia({ colorScheme: null });
  });

  check('downloads: settings: no page errors', t.errors.length === errorsBefore, json(t.errors.slice(errorsBefore)));
  await resetDl(t);
  await page.close();
}
