# pdf-editor-mobile

Expo (SDK 54) shell for the PDF editor. The editor itself lives in
`packages/pdf-editor-engine`; `pnpm --filter pdf-editor-mobile start` runs
`packages/pdf-editor-engine/build.mjs` first (`prestart`) to regenerate the
inlined `assets/editor/editor.html`, then boots Metro.

The desktop shell is `apps/pdf-editor-desktop`.

The full guide (features, how text editing works, limitations, third-party code) is in `packages/pdf-editor-engine/README.md`.
