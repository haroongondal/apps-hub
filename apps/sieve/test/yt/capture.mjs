import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { inflateSync } from 'node:zlib';
import { ROW_ORDER } from '../../../../packages/sieve-core/src/yt-actions.ts';
import { SEL } from '../../src/yt/selectors.ts';
import { openYt, row, rowButton, sendToTab, setYouTube, until } from './helpers.mjs';

const json = (v) => JSON.stringify(v);
const NOT_READY = "Sieve can't take a screenshot yet. Play the video first.";
const NOT_ALLOWED = 'Chrome only opens picture-in-picture from a click on the page. Use the Picture-in-picture button under the video.';
const toastText = (page) => row(page).getByRole('status').innerText();
const downloads = (t) => t.sw.evaluate(() => chrome.downloads.search({ orderBy: ['startTime'] }));
const ready = (page) => until(() => page.evaluate((s) => { const v = document.querySelector(s); return v?.readyState >= 2 && v.videoWidth > 0; }, SEL.video).catch(() => false), 8000);

async function newDownload(t, before, ms = 8000) {
  return until(async () => {
    const all = await downloads(t);
    return all.length > before && all[all.length - 1].state !== 'in_progress' ? all[all.length - 1] : null;
  }, ms);
}

function decodePng(buf) {
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  let off = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const kind = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (kind === 'IHDR') [width, height, type] = [data.readUInt32BE(0), data.readUInt32BE(4), data[9]];
    if (kind === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= bpp ? px[y * stride + i - bpp] : 0;
      const b = y ? px[(y - 1) * stride + i] : 0;
      const c = y && i >= bpp ? px[(y - 1) * stride + i - bpp] : 0;
      px[y * stride + i] = (x + [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]) & 255;
    }
  }
  return { width, height, at: (x, y) => [...px.subarray(y * stride + x * bpp, y * stride + x * bpp + 3)] };
}
const near = (rgb, want) => rgb.every((v, i) => Math.abs(v - want[i]) <= 24);

// The video shows four quadrants: red, blue (top), green, white (bottom), so a flip and a filter can be read from single pixels.
const quadrants = (page) => page.evaluate(async (s) => {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 180;
  const g = c.getContext('2d');
  const paint = () => [['#ff0000', 0, 0], ['#0000ff', 160, 0], ['#00ff00', 0, 90], ['#ffffff', 160, 90]].forEach(([fill, x, y]) => { g.fillStyle = fill; g.fillRect(x, y, 160, 90); });
  paint();
  setInterval(paint, 100);
  const v = document.querySelector(s);
  v.srcObject = c.captureStream(10);
  await v.play();
}, SEL.video);

// Downloads go to a temporary folder through Page.setDownloadBehavior, never to the owner's Downloads. Playwright renames every download it
// manages to a GUID, so the name and folder Sieve asks for are read from a spy on chrome.downloads.download in the worker.
const spyOnDownloads = (t) => t.sw.evaluate(() => {
  globalThis.__asked = [];
  globalThis.__download ??= chrome.downloads.download;
  chrome.downloads.download = (o) => { globalThis.__asked.push({ filename: o.filename, conflictAction: o.conflictAction, saveAs: o.saveAs, png: o.url.startsWith('data:image/png;base64,') }); return globalThis.__download.call(chrome.downloads, o); };
});
const asked = (t) => t.sw.evaluate(() => globalThis.__asked);
const downloadTo = async (t, page, dir) => (await t.ctx.newCDPSession(page)).send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });

export async function local(t) {
  const { check } = t;
  const dir = mkdtempSync(join(tmpdir(), 'sieve-shots-'));
  let page;
  try {
    await spyOnDownloads(t);
    page = await openYt(t, '/watch?v=sieveTest01&canvas=1');
    await downloadTo(t, page, dir);
    const shot = rowButton(page, 'Screenshot');
    const ids = await page.evaluate(() => [...document.querySelector('sieve-yt-row').shadowRoot.querySelectorAll('.bar > [data-id]')].map((e) => e.dataset.id));
    check('capture: the row has "Screenshot" and "Picture-in-picture" buttons, the second right after the first', (await ready(page)) && ids.includes('screenshot') && ids.indexOf('pip') === ids.indexOf('screenshot') + 1, json(ids));
    check('capture: ROW_ORDER puts pip after screenshot and before download', ROW_ORDER.indexOf('pip') === ROW_ORDER.indexOf('screenshot') + 1 && ROW_ORDER.indexOf('download') === ROW_ORDER.indexOf('pip') + 1);
    const pip = rowButton(page, 'Picture-in-picture');
    check('capture: the pip button shows an icon and no text, and is not pressed', (await pip.innerText()) === '' && (await pip.locator('svg').count()) === 1 && (await pip.getAttribute('aria-pressed')) === 'false');

    let n = (await downloads(t)).length;
    await shot.click();
    const d = await newDownload(t, n);
    const file = d && existsSync(d.filename) ? readFileSync(d.filename) : null;
    const png = file && decodePng(file);
    check('capture: a click on "Screenshot" gives a finished PNG download from the extension', d?.state === 'complete' && d.mime === 'image/png' && d.byExtensionId === t.id, json(d));
    const first = (await asked(t))[0];
    check('capture: the extension asks for the Sieve folder, a name from the video and the time, a unique name on a clash and no dialog', /^Sieve\/sieveTest01 \d+-\d\d\.png$/.test(first?.filename ?? '') && first.conflictAction === 'uniquify' && first.saveAs === false && first.png, json(first));
    check('capture: the file is a PNG of 320 by 180', png?.width === 320 && png.height === 180, json({ size: file?.length, w: png?.width, h: png?.height }));
    check('capture: the toast says "Screenshot saved"', await until(async () => (await toastText(page)) === 'Screenshot saved', 2000), await toastText(page));

    n = (await downloads(t)).length;
    await sendToTab(t, page, { type: 'yt-command', action: 'screenshot' });
    const viaCommand = await newDownload(t, n);
    check('capture: the shortcut command "screenshot" (no click) also downloads a PNG', viaCommand?.state === 'complete' && viaCommand.mime === 'image/png', json(viaCommand));

    n = (await downloads(t)).length;
    await page.evaluate(() => document.querySelector('sieve-yt-row').shadowRoot.querySelector('[data-id="screenshot"] > button').click());
    await sleep(1500);
    check('capture: a page script\'s click() on the Screenshot button makes no download', (await downloads(t)).length === n, `${(await downloads(t)).length} vs ${n}`);
    await page.evaluate(() => { document.title = 'a~b\u200fc\u0085d - YouTube'; });
    n = (await downloads(t)).length;
    await shot.click();
    const odd = await newDownload(t, n);
    const oddName = (await asked(t)).at(-1)?.filename ?? '';
    check('capture: a title with ~, a right-to-left mark and a C1 control gives a legal name (no ~, Cc or Cf) and the download finishes', /^Sieve\/a bc d \d+-\d\d\.png$/.test(oddName) && !/[~\p{Cc}\p{Cf}]/u.test(oddName) && odd?.state === 'complete', json({ oddName, state: odd?.state, error: odd?.error }));
    await page.close();

    page = await openYt(t, '/watch?v=sieveTest01&canvas=1&autoplay=0');
    await downloadTo(t, page, dir);
    await ready(page);
    await quadrants(page);
    await ready(page);
    await sleep(400);
    const take = async () => {
      const before = (await downloads(t)).length;
      await rowButton(page, 'Screenshot').click();
      const got = await newDownload(t, before);
      return got && existsSync(got.filename) ? decodePng(readFileSync(got.filename)) : null;
    };
    const plain = await take();
    check('capture: a plain screenshot has red at the top left and white at the bottom right', !!plain && near(plain.at(10, 10), [255, 0, 0]) && near(plain.at(310, 170), [255, 255, 255]), json(plain && [plain.at(10, 10), plain.at(310, 170)]));
    await sendToTab(t, page, { type: 'yt-command', action: 'flip-h' });
    await until(() => page.evaluate((s) => getComputedStyle(document.querySelector(s)).transform !== 'none', SEL.video), 2000);
    const flipped = await take();
    check('capture: with Flip horizontally the top left shows what was at the top right (blue)', !!flipped && near(flipped.at(10, 10), [0, 0, 255]) && near(flipped.at(310, 10), [255, 0, 0]), json(flipped && [flipped.at(10, 10), flipped.at(310, 10)]));
    await sendToTab(t, page, { type: 'yt-command', action: 'flip-v' });
    await setYouTube(t, { player: { filtersOn: true, filters: { invert: 100 } } });
    await until(() => page.evaluate((s) => getComputedStyle(document.querySelector(s)).filter !== 'none', SEL.video), 2000);
    const both = await take();
    check('capture: with both flips and the invert filter the top left is the inverse of white (black)', !!both && near(both.at(10, 10), [0, 0, 0]) && near(both.at(310, 170), [0, 255, 255]), json(both && [both.at(10, 10), both.at(310, 170)]));
    await page.close();

    // A real screenshot of a full-HD video is several MB as a data URL; Chrome's own URL limit is 2 MB in some places.
    const big = 'data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(8 * 1024 * 1024);
    n = (await downloads(t)).length;
    const result = await t.sw.evaluate((url) => chrome.downloads.download({ url, filename: 'Sieve/big.png', conflictAction: 'uniquify', saveAs: false }).then(() => 'started', (e) => String(e?.message ?? e)), big);
    const bigDone = result === 'started' ? await newDownload(t, n, 15_000) : null;
    check('capture: an 8 MB PNG data URL downloads (data URLs over 2 MB work)', result === 'started' && bigDone?.state === 'complete' && bigDone.fileSize > 5_000_000, `${result} ${json(bigDone && [bigDone.state, bigDone.error, bigDone.fileSize])}`);

    page = await openYt(t, '/watch?v=sieveTest01&state=unplayable');
    await until(() => row(page).count().then((c) => c === 1), 3000);
    n = (await downloads(t)).length;
    await rowButton(page, 'Screenshot').click();
    check('capture: with no playable video the toast says to play it first', await until(async () => (await toastText(page)) === NOT_READY, 2000), await toastText(page));
    await sleep(500);
    check('capture: and nothing is downloaded', (await downloads(t)).length === n);
    await page.close();

    // Headless Chrome for Testing opens picture-in-picture with no click at all (inspected 2026-11-11), so a refusal cannot be shown here: it is on the owner checklist.
    page = await openYt(t, '/watch?v=sieveTest01&canvas=1&autoplay=0');
    await ready(page);
    await sendToTab(t, page, { type: 'yt-command', action: 'pip' });
    const bare = await until(() => page.evaluate(() => !!document.pictureInPictureElement), 3000);
    check('capture: the shortcut command "pip" shows no refusal toast unless Chrome refused it (headless does not)', bare ? (await toastText(page)) === '' : (await until(async () => (await toastText(page)) === NOT_ALLOWED, 2000)), `${bare} ${await toastText(page)}`);
    check('capture: picture-in-picture opened by a command shows the button pressed', !bare || (await until(async () => (await rowButton(page, 'Picture-in-picture').getAttribute('aria-pressed')) === 'true', 2000)));
    await page.close();

    page = await openYt(t, '/watch?v=sieveTest01&canvas=1&autoplay=0');
    const warnings = [];
    page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
    await ready(page);
    await rowButton(page, 'Picture-in-picture').click();
    const pressed = await until(async () => (await rowButton(page, 'Picture-in-picture').getAttribute('aria-pressed')) === 'true', 3000);
    const inPip = await page.evaluate((s) => document.pictureInPictureElement === document.querySelector(s), SEL.video);
    const refused = warnings.find((w) => /picture-in-picture did not open/.test(w));
    check('capture: a trusted click on the pip button opens picture-in-picture and the button is pressed (or headless Chrome refuses it)', (pressed && inPip) || (!!refused && /NotSupportedError/.test(refused) && !pressed), json({ pressed, inPip, refused }));
    if (inPip) {
      await rowButton(page, 'Picture-in-picture').click();
      check('capture: a second click closes it and the button is not pressed', await until(async () => (await rowButton(page, 'Picture-in-picture').getAttribute('aria-pressed')) === 'false', 3000));
    } else console.log(`NOTE  capture: picture-in-picture did not open in this headless Chrome: ${refused ?? 'no warning'}`);
    await page.close();
  } finally {
    await page?.close().catch(() => {});
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube'));
    rmSync(dir, { recursive: true, force: true });
    await t.sw.evaluate(() => { if (globalThis.__download) chrome.downloads.download = globalThis.__download; });
  }
}

export async function live(t) {
  const { check, page } = t;
  const dir = mkdtempSync(join(tmpdir(), 'sieve-shots-'));
  try {
    await downloadTo(t, page, dir);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction((s) => document.querySelector('sieve-yt-row') && document.querySelector(s)?.currentTime > 5, SEL.video, { timeout: 40_000 }).catch(() => {});
    const ad = await page.evaluate(() => !!document.querySelector('#movie_player.ad-showing')).catch(() => true);
    if (ad) return console.log('SKIP  capture live: an ad was showing');
    const size = await page.evaluate((s) => { const v = document.querySelector(s); return [v.videoWidth, v.videoHeight, v.readyState]; }, SEL.video);
    await spyOnDownloads(t);
    const n = (await downloads(t)).length;
    await rowButton(page, 'Screenshot').click();
    const d = await newDownload(t, n, 10_000);
    const name = (await asked(t))[0]?.filename ?? '';
    check('live capture: the name is Sieve/<the video\'s title> <time>.png, not the empty-title fallback', /^Sieve\/.+ \d+-\d\d\.png$/.test(name) && !name.startsWith('Sieve/YouTube video '), name);
    const png = d && existsSync(d.filename) ? decodePng(readFileSync(d.filename)) : null;
    check('live capture: "Screenshot" after 5 s of playback gives a PNG as large as the video', !!png && size[2] >= 2 && png.width === size[0] && png.height === size[1], json({ png: png && [png.width, png.height], size, d: d && [d.state, d.error, d.filename] }));
    check('live capture: the toast says "Screenshot saved"', await until(async () => (await toastText(page)) === 'Screenshot saved', 3000), await toastText(page));
  } finally {
    await t.sw.evaluate(() => { if (globalThis.__download) chrome.downloads.download = globalThis.__download; }).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}
