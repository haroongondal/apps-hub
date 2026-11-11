// What Sieve knows about YouTube's pages for Task 2.12. Every value was read from the live pages, never from memory:
// inspected 2026-11-11, signed out, Chrome for Testing 149.0.7827.55, no extension, en-GB UI (html lang="en-GB"), fresh temporary profile.
// test/yt/tidy.mjs (live) fails with the name of the entry that stopped matching. Hiding rules are in tidy.css and use these same names.
//
// Shorts (a search for "funny cats", the side guide at 1400 px and 800 px wide, a channel's Shorts tab):
// - Search results: `grid-shelf-view-model` children of `ytd-item-section-renderer #contents`, one per Shorts shelf (three on that page), each holding a header
//   (`yt-section-header-view-model`), a grid and a bottom button. Every Short in it is `ytm-shorts-lockup-view-model` (inside a `-v2` element) with a link
//   `a[href^="/shorts/<id>"]`. The shelf has no attribute that says "Shorts" and the other `grid-shelf-view-model` elements did not appear on that page,
//   so the rules use `:has(ytm-shorts-lockup-view-model)` (no attribute or element name separates a Shorts shelf from another grid shelf).
// - A channel's Shorts tab: `ytd-rich-grid-renderer[is-shorts-grid]` of `ytd-rich-item-renderer[is-shorts-grid][is-slim-media]`, each holding `ytm-shorts-lockup-view-model`.
// - The signed-out home page showed no videos and no Shorts shelf (an empty `ytd-rich-grid-renderer`), so the home rules reuse the two element names above
//   (`ytd-rich-section-renderer` and `ytd-rich-item-renderer` containing a Shorts lockup) and are not seen on a real home page. Limit: re-check signed in (Task 2.19).
// - Side guide: `ytd-guide-entry-renderer` with `a#endpoint[title="Shorts"]` (no href, so the title is all there is: English only). The mini guide (shown at 800 px
//   wide) has `ytd-mini-guide-entry-renderer` with `a#endpoint[href="/shorts/"]`.
// - A channel's tab strip: `yt-tab-shape[tab-title="Shorts"]` (English only).
//
// Watch page (dQw4w9WgXcQ; a live stream, ZTNT_DuaL3Q, an ATN News live stream found with the search filter for live):
// - Related column: `#related` (two of them in the page: one in `#secondary-inner`, one inside `#related-skeleton`) holding `ytd-watch-next-secondary-results-renderer`.
// - Comments: `ytd-comments#comments` in `#below` (a second `ytd-comments` element without the id exists elsewhere).
// - Live chat: `ytd-live-chat-frame#chat` inside `#chat-container` (with an iframe `#chatframe`), added only for a stream with chat: on a stream without it
//   (Lofi Girl, player unavailable signed out) `#chat-container` held only `dom-if#chat-template`.
// - Info cards: the player's `.ytp-cards-button` (aria-label "Show cards") and `.ytp-cards-teaser` (display none until a card is due).
// - End screens: `.ytp-ce-element` (four on dQw4w9WgXcQ, visibility hidden until the end), `.ytp-ce-covering-overlay` and YouTube's own end grid `.ytp-endscreen-content`.
// - Comments sort menu: `#sort-menu` (a span in `ytd-comments-header-renderer`) with a `yt-dropdown-menu`; its listbox `tp-yt-paper-listbox#menu` is in the DOM while closed and holds two
//   `a.yt-simple-endpoint`: Top (`aria-selected="true"`) and Newest (`aria-selected="false"`). Newest is the second one, found by position, so the language does not matter.
//   Calling `.click()` on the second `a` with the menu closed made it `aria-selected="true"`, Top `false`, left the menu closed (`opened` false) and replaced the comments.
//   The anchors were there 10 ms after scrolling to the comments.
// - Description: `ytd-text-inline-expander#description-inline-expander` has `show-expand-button` and `always-show-expand-button` while collapsed, with a visible `#expand`
//   (`tp-yt-paper-button`, text "more"). `#expand`.click() gave the attribute `is-expanded` (and removed `show-expand-button`), hid `#expand` and showed `#collapse` ("Show less").
//
// Videos per row (@YouTube's Videos, Shorts and Posts tabs, the home page, all signed out, 1400 px wide):
// - `html` sets `--ytd-rich-grid-items-per-row: 4`, `--ytd-rich-grid-posts-per-row: 3` and `--ytd-rich-grid-slim-items-per-row: 6`. YouTube's script then sets inline on
//   `ytd-rich-grid-renderer` `--ytd-rich-grid-items-per-row: 3`, `--ytd-rich-grid-posts-per-row: 3`, `--ytd-rich-grid-slim-items-per-row: 5` (and the attribute `elements-per-row="3"`).
// - Videos grid (home, channel Videos): the item width follows `--ytd-rich-grid-items-per-row`. A rule `ytd-rich-grid-renderer { --ytd-rich-grid-items-per-row: 2 !important }`
//   beat the inline value: the first item went from 347 px to 529 px. The slim and posts variables left it at 347 px.
// - Shorts grid (`[is-shorts-grid]`, channel Shorts tab): the item width follows `--ytd-rich-grid-slim-items-per-row` (208 px to 525 px at 2). The other two left it at 208 px.
// - `ytd-browse[page-subtype]` is "home" on the home page and "channels" on a channel's tabs.
// - Posts: on @YouTube's Posts tab the posts are `ytd-backstage-post-thread-renderer` (ten) in a `ytd-section-list-renderer`, with no `ytd-rich-item-renderer`, and no
//   variable was seen changing anything there. `--ytd-rich-grid-posts-per-row` is the only posts variable (`.ytdRichItemRendererIsPost` reads it); where a rich grid
//   shows posts it applies. Limit: no page seen here uses it, so "Posts per row" is untested live.
export const TIDY_SEL = {
  comments: 'ytd-comments#comments',
  // the second one is Newest
  sortItems: '#sort-menu a.yt-simple-endpoint',
  below: '#below',
  expander: 'ytd-text-inline-expander#description-inline-expander',
  expand: '#expand',
  related: '#related',
  chat: 'ytd-live-chat-frame#chat',
  cardsButton: '.ytp-cards-button',
  endScreen: '.ytp-ce-element',
  shortsLockup: 'ytm-shorts-lockup-view-model',
  gridShelf: 'grid-shelf-view-model',
  shortsGridItem: 'ytd-rich-item-renderer[is-shorts-grid]',
  guideShorts: 'ytd-guide-entry-renderer a[title="Shorts"]',
  miniGuideShorts: 'ytd-mini-guide-entry-renderer a[href="/shorts/"]',
  channelTabShorts: 'yt-tab-shape[tab-title="Shorts"]',
  grid: 'ytd-rich-grid-renderer',
  gridItem: 'ytd-rich-item-renderer',
} as const;

export const SELECTED_ATTR = 'aria-selected';
export const EXPANDED_ATTR = 'is-expanded';
export const CAN_EXPAND_ATTR = 'show-expand-button';
export const SUBTYPE_ATTR = 'page-subtype';
export const SUBTYPE = { home: 'home', channel: 'channels' } as const;
export const SHORTS_GRID_ATTR = 'is-shorts-grid';
export const PER_ROW_VAR = { items: '--ytd-rich-grid-items-per-row', slim: '--ytd-rich-grid-slim-items-per-row', posts: '--ytd-rich-grid-posts-per-row' } as const;
