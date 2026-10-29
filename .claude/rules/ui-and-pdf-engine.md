---
paths:
  - "packages/ui/**"
  - "packages/pdf-editor-engine/**"
  - "apps/pdf-editor-mobile/**"
  - "apps/pdf-editor-desktop/**"
---

# UI tokens and the PDF engine

- Tokens flow one way: `packages/ui/src/tokens.ts` → `pnpm --filter @apps-hub/ui build:css` → `packages/ui/web/tokens.css`. Never edit the CSS by hand. The `ui` test fails if it is stale and enforces WCAG AA contrast for every brand in light and dark.
- The same tokens feed the React Native components and the Electron/WebView CSS, so a token change affects every app.
- `packages/pdf-editor-engine/build.mjs` inlines the engine scripts plus `@apps-hub/ui` CSS and fonts into `apps/pdf-editor-mobile/assets/editor/editor.html`. The mobile `prestart` and the release `prepare` step both run it, so rebuild after changing the engine or UI CSS before testing mobile. The Electron app loads the engine files directly.
- `build.mjs` throws on an inline `</script>` or an unresolvable `url()`; fix the source rather than loosening the check.
