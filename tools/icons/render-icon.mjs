// Usage: node tools/icons/render-icon.mjs <svg> <appDir>. The SVG needs <rect id="plate" rx="228"> and <g id="mark">.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [svgPath, appDir] = process.argv.slice(2);
const svg = fs.readFileSync(svgPath, 'utf8');
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-'));
let n = 0;

function shot(markup, size, out, round = false) {
  const html = path.join(tmp, `p${n++}.html`);
  fs.writeFileSync(html, `<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;${round ? 'border-radius:50%;overflow:hidden' : ''}">${markup}</div></body></html>`);
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars', `--window-size=${size},${size}`, '--default-background-color=00000000', `--screenshot=${out}`, `file://${html}`], { stdio: 'ignore' });
}

const full = (s) => svg.replace('<svg ', `<svg width="${s}" height="${s}" `);
// Adaptive-icon foreground: the mark only, scaled into Android's 66/108 safe zone.
const fg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 1024 1024">${inner.replace(/<rect id="plate"[^>]*\/>/, '')}</svg>`
  .replace('<g id="mark">', '<g id="mark" transform="translate(512 512) scale(0.82) translate(-512 -519)">');
const square = (s) => full(s).replace(/rx="228"/, 'rx="0"');

shot(full(1024), 1024, path.resolve(appDir, 'assets/icon.png'));
shot(fg(1024), 1024, path.resolve(appDir, 'assets/android-icon-foreground.png'));
const res = path.resolve(appDir, 'android/app/src/main/res');
for (const [d, k] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
  const dir = path.join(res, `mipmap-${d}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, markup, size, round] of [
    ['ic_launcher', full(48 * k), 48 * k, false],
    ['ic_launcher_round', square(48 * k), 48 * k, true],
    ['ic_launcher_foreground', fg(108 * k), 108 * k, false],
  ]) {
    const png = path.join(tmp, `${d}-${name}.png`);
    shot(markup, size, png, round);
    execFileSync('cwebp', ['-quiet', '-lossless', png, '-o', path.join(dir, `${name}.webp`)]);
  }
}
console.log(`icons written for ${appDir}`);
