// The page sizes the editor's Resize panel offers (packages/design-editor-engine/app.js PRESETS).
// page-sizes.test.ts keeps the two lists equal.
export const PAGE_SIZES: readonly [name: string, width: number, height: number][] = [
  ['Instagram post', 1080, 1080], ['Instagram story', 1080, 1920], ['Facebook post', 1200, 630],
  ['YouTube thumbnail', 1280, 720], ['Presentation 16:9', 1920, 1080], ['A4 portrait', 2480, 3508],
  ['Poster 18×24 in', 1800, 2400], ['Business card', 1050, 600], ['LinkedIn banner', 1584, 396],
];

// A blank design at a chosen size, in the shape the page restores from its autosave slot.
export const blankDesign = (w: number, h: number) => JSON.stringify({ W: w, H: h, pages: [{ objects: [], background: '#ffffff' }] });
