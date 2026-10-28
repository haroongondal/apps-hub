# Design Editor

A free, offline design editor for the Mac, in the spirit of Canva. Make social posts, posters, invites and thumbnails, then download them as PNG, JPG, SVG or PDF. It has no account or subscription and doesn't need the internet. Your files stay on your computer.

![Design Editor with the event invite template open](docs/screenshot.png)

## Features

- **Pages**: a design holds as many pages as you like, all the same size. Add, duplicate, reorder and delete them in the page strip under the page.
- **Templates** that fit any page size: a sale poster, a quote card, an event invite and a product launch. On an empty page a template fills it; otherwise it goes on a new page.
- **Elements**: shapes, lines and stars, plus heading, subheading and body text
- **Uploads**: drop, paste or pick images
- **Magic resize**: switch between nine presets (Instagram post and story, YouTube thumbnail, A4, presentation and more) or a custom size, with the content of every page scaled to fit
- **Fonts that travel**: Atkinson Hyperlegible Next, Jost, Playfair Display and Dancing Script come with the app, so a design looks the same on any Mac. Fonts installed on your Mac are still there, marked "This Mac only".
- **Brand kit**: saved brand colours, applied with one click, and heading and body fonts that new text uses
- **Background remover** for product shots and logos on plain backgrounds, with an adjustable tolerance
- **Image adjustments**: brightness, contrast, blur, and black and white
- **Editing**: layers, grouping, locking, flipping, aligning to the page, snapping to the page centre, and undo and redo
- **Downloads**: PNG, transparent PNG, JPG, SVG or PDF at 1×, 2× or 3×. A PDF holds every page, with real text you can select and search. Images download the current page, or every page as one file each.
- **Mac app behaviour**: native menus and Open and Save dialogs, and the title bar shows unsaved changes. Every change is autosaved, so quitting never loses work.

## Install

You need [Node.js](https://nodejs.org) 20 or later.

```sh
git clone https://github.com/haroongondal/design-editor.git
cd design-editor
npm install
npm run dist
```

That builds `dist/Design Editor-darwin-arm64/Design Editor.app`. Drag it into Applications. The app isn't code-signed, so the first time you open it, right-click it and choose **Open**.

To run it from source without building, use `npm start`.

## Shortcuts

| Action | Keys |
| --- | --- |
| Undo, redo | ⌘Z, ⇧⌘Z |
| Copy, cut, paste | ⌘C, ⌘X, ⌘V |
| Duplicate | ⌘D |
| Group, ungroup | ⌘G, ⇧⌘G |
| Nudge by 1 px, by 10 px | Arrow keys, ⇧ + arrow keys |
| Delete | Delete |
| Save, save as | ⌘S, ⇧⌘S |
| Download | ⇧⌘E |
| Zoom in, out, fit | ⌘=, ⌘−, ⌘0 |

## Limitations

- The background remover clears the plain colour around the edges of an image. It isn't an AI model, so busy photo backgrounds won't come out cleanly.
- Text in a "This Mac only" font may look different on another computer. If that font is missing there, the editor switches the text to Atkinson Hyperlegible Next and says which font it replaced.
- In PDF downloads, these kinds of text are part of the page image, so they can't be selected: text in a "This Mac only" font, text inside a group, text with an outline, shadow or gradient, text with mixed styles inside one box, and characters the font doesn't have, such as emoji. Use a font that comes with the app, and ungroup text, to keep it selectable.
- Shapes and images in PDF downloads are images at the download scale, not vector art.
- Each window holds one design.
- Builds are for Apple Silicon Macs.

## Development

```sh
npm start   # run from source
npm test    # drive the real app end to end, with the file dialogs stubbed
npm run dist
```

- **`main.js`**: menus, file dialogs, file writes and autosave.
- **`preload.cjs`**: the small bridge the page uses to reach them.
- **`index.html` and `app.js`**: the editor itself, built on [Fabric.js](https://fabricjs.com) 7.
- **`vendor/`**: Fabric.js, [pdf-lib](https://pdf-lib.js.org) and [@pdf-lib/fontkit](https://github.com/Hopding/fontkit), all MIT licensed, bundled so the app works offline.
- **`vendor/fonts/`**: the bundled fonts, all under the [SIL Open Font License 1.1](https://openfontlicense.org) (licence text next to each family): Atkinson Hyperlegible Next (Braille Institute), Jost (Owen Earl), Playfair Display (Claus Eggers Sørensen) and Dancing Script (Pablo Impallari). The Atkinson Hyperlegible Next regular, semibold and extra bold faces come from the shared `vendor/ui/fonts`.
- **Design files** are JSON: `{ version: 2, W, H, fonts, pages }`, one Fabric canvas per page. Files from before pages (`{ W, H, canvas }`) still open.
