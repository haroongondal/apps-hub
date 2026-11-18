# Design Editor: Design with AI (layout and text)

Date 2026-11-18. Short design for a small change. The owner approved the approach on 2026-11-18
("layout and text first, go ahead"). Everything marked "(my call)" is unconfirmed.

## Intent

The owner describes a design in words ("a poster for a Friday open night at a pottery studio")
and the editor builds a page from its own elements, which they then edit like any other design.
Why: starting from a blank canvas is the slow part. The owner chose a cloud API over the local
Model Host because the phone's on-device models are far too slow for it (Model Host Phase 0:
about 10 tokens/s and 150 s per image).

## Goals

- One feature on both the Mac and the phone, because both load the same engine.
- The result uses only existing editor objects (text boxes, rectangle, circle, star, line) and
  the four bundled fonts, so it exports to PNG, SVG and PDF like everything else.
- One undo step puts the page back as it was.

## Non-goals

- Generated images or illustrations (a second provider; a later step the owner deferred).
- Editing the current design with AI, or sending the current design to the API.
- Streaming, chat or revisions ("make it bluer"). One prompt gives one page.

## Anti-goals (a failure even if it works)

- Silent network use. A request happens only after a tap on "Generate", and the panel says
  it contacts Anthropic.
- The key being readable by the page after it is entered (the field is cleared, nothing reads it back, and no message or log contains it).
- A reply that can crash the page or paint outside it. Replies are validated and clamped.

## Constraints

- The editor page's CSP blocks all network (`connect-src 'self' data: blob:`) and stays as it
  is. The HTTPS call happens in native code: Electron `main.js` on the Mac, the React Native
  layer (`bridge.ts`) on the phone. The page only calls `native.ai.*`.
- This reverses the PRD's "offline, no cloud" rule for this one feature. PRD §8 gets a line.
- What is sent: the prompt, the page size and the system prompt. No design content, no files.
- Fonts: Atkinson Hyperlegible Next, Jost, Playfair Display, Dancing Script. Weights regular
  and bold, italic where bundled.

## Approaches

1. **Engine builds the page from a validated layout (picked).** Claude returns a layout through
   a tool call (`input_schema`), the pure module `ai-layout.js` validates and clamps it,
   and `app.js` builds Fabric objects the way `applyTemplate` does. Native only stores the key
   and forwards the request. Trade-off: the layout vocabulary is small (five object types).
2. **Claude returns a full design JSON** in the editor's save format. More expressive, but the
   model must know Fabric's serialisation, and a malformed reply can load a broken page.
   Rejected: the validation surface is far larger.
3. **Claude returns SVG that is imported.** Rejected: the editor has no SVG import, and text
   would become paths that cannot be edited.

## The design

**`packages/design-editor-engine/ai-layout.js`** (pure, no DOM, loaded by `desktop.html` and
inlined by `build.mjs` for the phone, and `require`-able from `node --test`):

- `buildRequest(prompt, W, H)` returns the Messages API body: model constant (my call:
  `claude-sonnet-5-5`), a system prompt that states the page size and the allowed fonts, one
  tool `make_layout`. `tool_choice` is `auto`: the Messages API rejects a forced tool on this
  model (claude-api skill, 2026-11-18), so the prompt asks for exactly one call and
  `parseReply` throws when there is none.
- Layout schema: `{ bg: "#rrggbb", items: [...] }`, at most 30 items. Each item has `type`
  (`text`, `rect`, `circle`, `star`, `line`), a centre `x`, `y` and size `w`, `h` as fractions
  of the page (0 to 1). Text adds `text` (at most 300 characters), `size` as a fraction of the
  shorter side (0.01 to 0.3), `font`, `bold`, `italic`, `align`. Shapes add `fill`. Rectangles
  add `round` (0 to 0.5). Lines add `stroke`.
- `parseReply(json)` finds the `tool_use` block, then validates: unknown types dropped, colours
  must match `#rrggbb` (else a dark default), numbers clamped, unknown fonts replaced by
  Atkinson. Returns `{ bg, items }`, or throws an error whose message is plain words
  ("The reply had no layout. Try again.").

**`app.js`**: a rail tab "AI" with a prompt field, a "Generate" button, a status line, and
"Anthropic API key" (a password field plus "Save"). `generate()` asks `native.ai.request`,
calls `parseReply`, then `applyTemplate({ bg, items: () => buildItems(layout) })`. The sizes
use the same `s()` scale as the templates.

**Mac** (`preload.cjs`, `main.js`): `ai.hasKey()`, `ai.setKey(key)`, `ai.request(body)`. The key
is encrypted with Electron `safeStorage` and written under `userData`; `request` posts to
`https://api.anthropic.com/v1/messages` with `x-api-key` and `anthropic-version`, 60 s timeout,
and returns the response text or a plain error.

**Phone** (`shell-mobile.js`, `bridge.ts`, `editor.tsx`): the same three calls as bridge
messages `aiHasKey`, `aiSetKey`, `aiRequest`. RN `fetch` does the request. The key goes in a
file in the app's private storage (my call; shortcut: not hardware-backed, upgrade to
`expo-secure-store` if the owner wants it).

**Errors in plain words**: no key ("Add your Anthropic API key first"), 401 ("The API key was
refused. Check it and save it again."), 429, timeout, offline, bad reply.

## Tests

`packages/design-editor-engine/test/ai-layout.test.js` with `node --test`: a good reply parses,
bad colours and fonts are repaired, out-of-range numbers are clamped, more than 30 items are cut,
a reply with no tool block throws. No Electron suite is run (owner's rule).

## Left to the builder

Visual styling of the AI panel using the existing `--c-*` tokens, and the exact system-prompt
wording. Check the Messages API field names against the `claude-api` skill before coding.
