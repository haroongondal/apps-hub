// The picker's "Move panel" button, called from e2e.mjs with its picker helpers. The panel starts in the bottom-right corner, where a fixed item
// (a chat bubble, a toast) sits under it and scrolling cannot clear it. The page is on 127.0.0.1, so its pick stays apart from localhost's.
import { isDeepStrictEqual as same } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { check } from './harness.mjs';

const json = (v) => String(JSON.stringify(v)).slice(0, 500);

export async function checkMovePanel({ ctx, servers, errors, startPicker, until, displayOf, myFiltersOf, hideDataOf, pw, shots }) {
  const FIXED = `https://127.0.0.1:${servers.httpsPort}/pick-fixed.html`;
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 760, height: 460 });
  await page.goto(FIXED, { waitUntil: 'load' });
  await startPicker(page, FIXED);

  const btn = (name) => page.getByRole('button', { name, exact: true });
  const geometry = () =>
    page.evaluate(() => {
      const r = (el) => {
        const b = el.getBoundingClientRect();
        return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)];
      };
      const root = document.querySelector('sieve-picker').shadowRoot;
      const panel = root.querySelector('.panel');
      return { panel: r(panel), box: r(root.querySelector('.box')), toast: r(document.querySelector('.toast')), moved: panel.classList.contains('top') };
    });
  const covers = (g) => g.panel[0] <= g.toast[0] && g.panel[1] <= g.toast[1] && g.panel[2] >= g.toast[2] && g.panel[3] >= g.toast[3];
  const center = (g) => [(g.toast[0] + g.toast[2]) / 2, (g.toast[1] + g.toast[3]) / 2];
  const shoot = async (name) => {
    await page.screenshot({ path: join(shots, `${name}.png`) });
    await page.emulateMedia({ colorScheme: 'dark' });
    await sleep(400); // the buttons fade between themes
    await page.screenshot({ path: join(shots, `${name}-dark.png`) });
    await page.emulateMedia({ colorScheme: 'light' });
    await sleep(400);
  };

  const start = await geometry();
  await page.mouse.move(...center(start), { steps: 12 });
  const reached = await geometry();
  check(
    'a fixed item in the bottom-right corner is under the panel: the pointer reaches the panel, not the item, and the panel does not move on its own',
    covers(start) && !start.moved && same(reached.panel, start.panel) && !reached.moved && !same(reached.box, reached.toast) && (await displayOf(page, '.toast')) !== 'none',
    json({ start, reached }),
  );

  await page.evaluate(() => [...document.querySelector('sieve-picker').shadowRoot.querySelectorAll('button')].find((b) => b.textContent === 'Move panel').click());
  await sleep(300);
  const untrusted = await geometry();
  check('a page that clicks "Move panel" itself moves nothing', same(untrusted.panel, start.panel) && !untrusted.moved, json(untrusted));

  await btn('Move panel').click();
  const top = await geometry();
  check('"Move panel" moves the panel to the top-left corner, off the item', top.moved && top.panel[0] < 40 && top.panel[1] < 40 && !covers(top), json(top));
  await btn('Move panel').click();
  const back = await geometry();
  check('a second click moves the panel back to the bottom-right corner', !back.moved && same(back.panel, start.panel) && covers(back), json({ start: start.panel, back }));
  await btn('Move panel').click();

  const [x, y] = center(top);
  await page.mouse.move(x, y, { steps: 5 });
  const over = await geometry();
  await page.mouse.click(x, y);
  await page.locator('sieve-picker .selector').waitFor({ state: 'visible' });
  const picked = [await page.locator('sieve-picker .selector').innerText(), await page.locator('sieve-picker p[aria-live]').innerText(), await page.evaluate(() => window.clicks)];
  check(
    'with the panel in the top-left corner, the item is outlined and can be picked: div.toast, "Hides 1 item on this page", and the page sees no click',
    same(over.box, over.toast) && same(picked, ['div.toast', 'Hides 1 item on this page', 0]),
    json({ over, picked }),
  );

  await shoot('picker-top');
  await btn('Move panel').click();
  const again = await geometry();
  await shoot('picker-bottom');
  check('the panel moves back to the bottom-right corner with the item still picked', !again.moved && again.panel[2] > 700 && again.panel[3] > 400 && (await page.locator('sieve-picker .selector').innerText()) === 'div.toast', json(again));

  await btn('Block it').click();
  const hidden = await until(() => displayOf(page, '.toast'), (d) => d === 'none');
  const stored = await until(async () => (await hideDataOf(pw))?.['127.0.0.1'], (v) => v !== undefined);
  check(
    'blocking it hides the item, closes the picker, and saves 127.0.0.1##div.toast',
    hidden === 'none' && (await page.locator('sieve-picker').count()) === 0 && same(stored, ['div.toast']) && (await myFiltersOf(pw)).split('\n').includes('127.0.0.1##div.toast'),
    json({ hidden, stored, filters: await myFiltersOf(pw) }),
  );
  await page.reload({ waitUntil: 'load' });
  const reloaded = await until(() => displayOf(page, '.toast'), (d) => d === 'none', 5_000);
  check('after a reload the item is still hidden', reloaded === 'none', reloaded);
  await page.close();
}
