// Inlines the five classic scripts and the two design-system stylesheets (fonts
// as data: URLs) of the mobile shell into one self-contained file for the Expo
// WebView asset. Pure Node, no dependencies. The vendor files keep their
// upstream license blurbs — inlining preserves their comment headers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const page = path.join(dir, 'mobile.html');
const out = path.resolve(dir, '../../apps/pdf-editor-mobile/assets/editor/editor.html');

const scripts = ['vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/pdf-lib.min.js', 'textedit.js', 'core.js'];
let html = fs.readFileSync(page, 'utf8');
for (const src of scripts) {
  const tag = `<script src="${src}"></script>`;
  if (!html.includes(tag)) throw new Error(`mobile.html is missing <${tag}>`);
  const js = fs.readFileSync(path.join(dir, src), 'utf8');
  // a bare "</script>" inside an inlined bundle would close the tag early; only
  // legal inside literals, so swapping to "<\/script" keeps both worlds happy
  if (/<\/script/i.test(js)) throw new Error(`${src} contains an inline </script> — escape it before inlining`);
  // A string replacement would interpolate "$&"-style patterns found in the
  // vendor code (pdf-lib carries a literal "$&"); a function replacement is inert.
  const inline = `<script>/* ${src} — inlined by build.mjs (upstream headers preserved) */\n${js}\n</script>`;
  html = html.replace(tag, () => inline);
}

// The links stay relative so mobile.html also works straight from file://.
for (const href of ['../ui/web/tokens.css', '../ui/web/base.css']) {
  const tag = `<link rel="stylesheet" href="${href}">`;
  if (!html.includes(tag)) throw new Error(`mobile.html is missing <${tag}>`);
  const file = path.join(dir, href);
  const css = fs.readFileSync(file, 'utf8').replace(/url\('([^']+\.ttf)'\)/g, (_, rel) =>
    `url('data:font/ttf;base64,${fs.readFileSync(path.resolve(path.dirname(file), rel)).toString('base64')}')`);
  // the WebView gets this one file only, so any reference left unresolved would 404
  if (/url\((?!'data:)/.test(css)) throw new Error(`${href} has a url() build.mjs cannot inline`);
  if (/<\/style/i.test(css)) throw new Error(`${href} contains an inline </style>`);
  html = html.replace(tag, () => `<style>/* ${href} — inlined by build.mjs */\n${css}\n</style>`);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(path.resolve(dir, '../..'), out)} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB)`);
