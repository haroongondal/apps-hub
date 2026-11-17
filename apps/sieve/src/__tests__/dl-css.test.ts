import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// AGENTS.md: no hand-rolled colours in an app. Every colour in a declaration must come from a --c-* token.
const NAMED = new Set(
  ('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral ' +
    'cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid ' +
    'darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick ' +
    'floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender ' +
    'lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid ' +
    'mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy ' +
    'oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
    'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen canvas canvastext buttonface buttontext highlight graytext').split(' '),
);
const FUNCTIONS = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

function rawColours(css: string): string[] {
  const found: string[] = [];
  for (const [, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\{([^{}]*)\}/g)) {
    for (const decl of body.split(';')) {
      const colon = decl.indexOf(':');
      if (colon < 0 || decl.trim().startsWith('--')) continue;
      const value = decl.slice(colon + 1);
      if (/#[0-9a-f]{3,8}\b/i.test(value) || FUNCTIONS.test(value) || value.split(/[^a-z-]+/i).some((w) => NAMED.has(w.toLowerCase()))) found.push(decl.trim());
    }
  }
  return found;
}

test('rawColours finds hex, colour functions and named colours in declaration values only', () => {
  assert.deepEqual(rawColours('#add .x::backdrop { color: var(--c-text); background: transparent; border-color: currentColor; } /* black #fff */'), []);
  assert.deepEqual(rawColours('.a { color: black; } .b { background: #fff } .c { box-shadow: 0 0 2px rgb(0 0 0 / .5); } .d { white-space: nowrap; }'), ['color: black', 'background: #fff', 'box-shadow: 0 0 2px rgb(0 0 0 / .5)']);
  assert.deepEqual(rawColours('.e { outline: 1px solid Red }'), ['outline: 1px solid Red']);
});

test('the download pages take every colour from the --c-* tokens', () => {
  const src = new URL('../', import.meta.url);
  const dir = new URL('dl/', src);
  const sheets: [string, string][] = readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]);
  for (const [f, marker] of [['popup.css', '/* Downloads tab (phase 3) */'], ['options.css', '/* Downloads section (phase 3) */']]) {
    const css = readFileSync(new URL(f, src), 'utf8');
    assert.ok(css.includes(marker), `${f} has its Phase 3 block (it runs to the end of the sheet)`);
    sheets.push([f, css.slice(css.indexOf(marker))]);
  }
  assert.ok(sheets.length >= 3);
  for (const [f, css] of sheets) assert.deepEqual(rawColours(css), [], f);
});
