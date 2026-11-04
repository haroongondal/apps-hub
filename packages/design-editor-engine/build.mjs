// Inlines the three vendor scripts plus shell-mobile.js, app.js and touch.js of the mobile
// page, and the design-system stylesheet (fonts as data: URLs) into one self-contained file
// for the Expo WebView asset. Pure Node, no dependencies. Also publishes window.__fontsData —
// the page's fonts resolve from that table in the WebView, because the asset alone ships no
// font files (shell-mobile.js's shims read it). The vendor files keep their upstream license
// blurbs — inlining preserves their comment headers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const page = path.join(dir, 'mobile.html');
const out = path.resolve(dir, '../../apps/design-editor-mobile/assets/editor/editor.html');

// the font table goes in just before shell-mobile.js, which reads it at eval time
const fontDirs = ['vendor/fonts', '../ui/fonts'];
const fonts = {};
for (const folder of fontDirs) {
  const abs = path.join(dir, folder);
  for (const f of fs.readdirSync(abs)) {
    if (!f.endsWith('.ttf')) continue;
    fonts[`${folder}/${f}`] = `data:font/ttf;base64,${fs.readFileSync(path.join(abs, f)).toString('base64')}`;
  }
}
if (!Object.keys(fonts).length) throw new Error('no .ttf fonts found under vendor/fonts or ../ui/fonts');
const table = `window.__fontsData = ${JSON.stringify(fonts)};`;
if (/<\/script/i.test(table)) throw new Error('the font table strings contain an inline </script>');

// app.js must run before touch.js (window.editor) and after shell-mobile.js (native.onMenu);
// SPEC §14.1 lists app.js before shell-mobile, which the four native.* calls make impossible —
// the as-built order lives in this array and in the handoff.
const scripts = ['vendor/fabric.min.js', 'vendor/pdf-lib.min.js', 'vendor/fontkit.min.js', 'shell-mobile.js', 'app.js', 'touch.js'];
let html = fs.readFileSync(page, 'utf8');
for (const src of scripts) {
  const tag = `<script src="${src}"></script>`;
  if (!html.includes(tag)) throw new Error(`mobile.html is missing <${tag}>`);
  const js = fs.readFileSync(path.join(dir, src), 'utf8');
  // a bare "</script>" inside an inlined bundle would close the tag early; only
  // legal inside literals, so swapping to "<\/script" keeps both worlds happy
  if (/<\/script/i.test(js)) throw new Error(`${src} contains an inline </script> — escape it before inlining`);
  // A string replacement would interpolate "$&"-style patterns found in the
  // vendor code; a function replacement is inert.
  let inline = `<script>/* ${src} — inlined by build.mjs (upstream headers preserved) */\n${js}\n</script>`;
  if (src === 'shell-mobile.js') inline = `<script>/* __fontsData — written by build.mjs (font bytes for the WebView) */\n${table}\n</script>\n${inline}`;
  html = html.replace(tag, () => inline);
}

// the stylesheet keeps only its token link; the inline <style> the page carries builds on it
const href = '../ui/web/tokens.css';
const link = `<link rel="stylesheet" href="${href}">`;
if (!html.includes(link)) throw new Error(`mobile.html is missing <${link}>`);
const file = path.join(dir, href);
const css = fs.readFileSync(file, 'utf8').replace(/url\('([^']+\.(?:ttf|woff2?))'\)/g, (_, rel) =>
  `url('data:font/ttf;base64,${fs.readFileSync(path.resolve(path.dirname(file), rel)).toString('base64')}')`);
// the WebView gets this one file only, so any reference left unresolved would 404
if (/url\((?!'data:)/.test(css)) throw new Error(`${href} has a url() build.mjs cannot inline`);
if (/<\/style/i.test(css)) throw new Error(`${href} contains an inline </style>`);
html = html.replace(link, () => `<style>/* ${href} — inlined by build.mjs */\n${css}\n</style>`);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(path.resolve(dir, '../..'), out)} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB, ${Object.keys(fonts).length} fonts)`);
