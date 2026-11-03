# Design Editor engine

The editor page: `desktop.html` (the Mac page), `app.js` (the editor: pages, objects, fonts, export),
and `vendor/` (Fabric.js, pdf-lib, fontkit and the bundled fonts). It has no build step and no
dependencies of its own; the Mac app and the Android app both load it.

- Mac: `apps/design-editor/vendor/engine` is a symlink to this folder, and `main.js` loads
  `vendor/engine/desktop.html`. Stylesheets use `../ui/web/...` (the `@apps-hub/ui` tokens), and
  the bundled fonts resolve through `vendor/fonts/` and `../ui/fonts/`.
- Android: the mobile page and its build come in Phase 3 step 2 (SPEC §14).
