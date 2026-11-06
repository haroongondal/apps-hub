'use strict';
// Every sentence of the shared editor page that differs between the Mac and the phone (PRD FR-13).
// The phone column is plain words with no mouse, shortcut or Mac wording; a test reads it
// (apps/design-editor-mobile/src/__tests__/plain-words.test.ts). The page picks its column
// from body.embedded, which shell-mobile.js sets before this file runs.
const COPY_TABLE = {
  desktop: {
    systemFonts: 'This Mac only',
    fontsFailed: 'Some bundled fonts didn’t load. Reinstall the app to fix this.',
    fontMissing: (names, sans) => `${names.join(', ')} ${names.length > 1 ? 'aren’t' : 'isn’t'} on this Mac, so that text now uses ${sans}.`,
    autosaveFailed: 'Autosave failed. Save to a file to keep your work.',
    sizeLabel: (w, h) => `${w} × ${h} px`,
    shortcuts: '⌘Z undo, ⇧⌘Z redo, ⌘D duplicate, ⌘C and ⌘V copy and paste, ⌘G group, ⇧⌘G ungroup, arrows nudge, Delete removes.',
    downloaded: (all, file) => (all ? 'Downloaded one file per page, starting with ' : 'Downloaded to ') + file,
    downloadFailed: 'The download didn’t finish. Try again, or pick another format.',
    notADesign: 'That file is not a design saved from this editor. Open a .json file you saved here.',
    sessionKept: kept => `Design Editor couldn’t restore your last session, so it started a new design. It saved that session to ${kept}. Open it with File > Open in the version that made it.`,
    sessionLost: 'Design Editor couldn’t restore your last session or save a copy of it, so it started a new design. Check that your Mac has free disk space.',
    hint: '',
    selectMany: () => '',
  },
  phone: {
    systemFonts: null, // the Mac's system fonts are not on a phone
    fontsFailed: 'Some fonts didn’t load. Restart the app. If it keeps happening, install it again from the Store.',
    fontMissing: (names, sans) => `${names.join(', ')} ${names.length > 1 ? 'aren’t' : 'isn’t'} on this phone, so that text now uses ${sans}.`,
    autosaveFailed: 'Couldn’t keep your latest changes. Tap Save to keep your work.',
    sizeLabel: (w, h) => `${w} × ${h}`,
    shortcuts: '',
    downloaded: all => (all ? 'Saved one image for each page in the Design Editor folder on this phone.' : 'Saved in the Design Editor folder on this phone.'),
    downloadFailed: 'Couldn’t save the image. Try again, or pick another format.',
    notADesign: 'That file isn’t a design from this editor. Pick a design you saved here.',
    sessionKept: () => 'Design Editor couldn’t restore your last session, so it started a new design.',
    sessionLost: 'Design Editor couldn’t restore your last session, so it started a new design. Check that your phone has free space.',
    hint: 'Pinch with two fingers to zoom. Drag empty space with one finger to move around.',
    selectMany: on => (on ? 'Select several: tap items to add or remove them.' : 'Select several is off.'),
  },
};
if (typeof window !== 'undefined') window.COPY = COPY_TABLE[document.body.classList.contains('embedded') ? 'phone' : 'desktop'];
if (typeof module !== 'undefined') module.exports = COPY_TABLE;
