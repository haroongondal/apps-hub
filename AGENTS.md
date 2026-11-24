# AGENTS.md — apps-hub Monorepo Guidelines

## What This Repo Is
A generic workspace hosting multiple mobile/desktop applications built with
React Native (+ Expo) and Electron. Apps live in `apps/`, shared logic lives
in `packages/`.

Current apps:
- **HomeNet** (`apps/netlens`, formerly NetLens) — FOSS, zero-telemetry LAN scanner & connectivity
  diagnostic toolkit with a router dashboard, device remotes, who's home, wake PC and guest QR.
  Android-first, iOS second. Feature docs: `docs/netlens/`.
  Background checks and shares (Android only, all off by default): "Tell me who is home" runs a
  WorkManager job about every 15 minutes that TCP-probes only the last known addresses of the
  phones the owner tagged (default ports, 350 ms, RST counts as home) and marks a person away only
  after 3 missed checks in a row. "Tell me when a new device joins" runs a bounded /24 TCP sweep
  through the existing engine (Semaphore 64, 350 ms, no mDNS or SSDP, so no multicast lock) every
  3, 6 (default), 12 or 24 hours. It raises a local notification for an address that is not this
  phone, not the router, not a saved device seen in the last 30 days, not tagged or trusted, and
  not reported or marked "This is mine" in the last 30 days; the notification shows the device
  guess, never its address, and is private on the lock screen. Both run only while the phone is on
  a Wi-Fi network (not VPN, not mobile data) matched by its router: the default gateway is the
  saved home gateway AND the router answers with the UPnP device ID (UDN) pinned when home was
  saved. A router that gives no ID cannot be saved as home, so the checks stay off (fail closed).
  Another Wi-Fi whose router uses the same address but another ID, or none, is not probed; no ARP
  table is read. A tag moves to a new device only on the same hostname or Bonjour name; a device
  that only calls itself "<person>'s …" is suggested on the Home tab and moves the tag only when
  the owner says yes. The sync (`syncHome`) sends only the home and the device snapshot; native
  keeps the stored switches, and the JS calls are ordered (`orderHomeWatch` in
  `packages/core/src/home-watch.ts`).
  "Share with my other Haroon apps" (off by default) serves two read-only signature-guarded
  shares on `com.haroon.netlens.applink` (`com.haroon.permission.AUTOPILOT`, `AppLinkCaller`
  first): `who_is_home` (person tag, present 0/1, last seen time) and `new_devices` (first seen
  time, a plain guess such as "iPhone or iPad", acknowledged 0/1). They never contain an IP or MAC
  address, hostname, port or scan detail. With sharing on, HomeNet also sends the data-free
  `com.haroon.autopilot.CHANGED` broadcast to `com.haroon.halo` only (`sendBroadcast` with the
  AUTOPILOT permission, no extras) after a background check finds a new device, and when someone
  arrives or leaves (at most once a minute), so Halo re-reads the two shares through their guard.
  The same provider serves the one-row `health` share (`appHealthShare('netlens')`: accessibility
  and listener null, `ai_source` none, a heartbeat written when the app opens or a background
  check runs, never by a query) to same-signed apps whether sharing is on or not. On Android the
  Router tab's "Restart the router with Deputy" opens Deputy's `PROPOSE_TASK` draft with
  `startActivityForResult` from the screen, carrying only HomeNet's fixed task text (no context,
  apps, address or credentials); Deputy starts nothing until the owner taps Start, and its
  confirmation gate is unchanged. iOS answers `{ supported: false }` and hides the button.
- **TunnelWall** (`apps/open_tunnel_vpn`, formerly OpenTunnel) — zero-registration VPN client
  aggregating VPN Gate relays + user WireGuard nodes. Migrated from Flutter to
  React Native (Expo SDK 54) on 2026-10-26 (Dart snapshot: commit `a8cf6e9`).
  Domain logic in `packages/open-tunnel-core`; phases in
  `apps/open_tunnel_vpn/.opencode/commands/`.
  Kill switch ("Block internet while the VPN is off", default on): once a tunnel has connected
  with it on, `OpenTunnelVpnService` holds its own all-routes interface that it never reads, so
  traffic is dropped while no engine interface is up (through a relay switch, after a drop or
  failed failover, and at an Always-on start after the process died). The app's own package stays
  outside the block so it can reach VPN Gate. Disconnect, Stop blocking, or any revoke lifts it.
  The app never calls `allowBypass()` and cannot set Android's Block connections without VPN; it
  reads `isAlwaysOn`/`isLockdownEnabled` and links to the VPN settings. Process death without
  Always-on is not covered. Trusted Wi-Fi (off by default, Android 12+): the Wi-Fi names and
  access points the user marks are stored only in the app's local sqlite and never leave the
  phone. Permissions added: `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION`, requested only
  when the user turns Trusted Wi-Fi on, because Android shows the Wi-Fi name only to apps allowed
  precise location. Shields (Settings, Android 12+, off by default) turns on Trusted Wi-Fi
  auto-connect and shares two rows with Halo through the signature-guarded provider
  `com.haroon.opentunnel.applink`: `shield` {on, untrusted_now, since}, served only while Shields
  is on, and `health` for the Store. `untrusted_now` is 1 while the network watch is not running
  or has not yet reported (for example after the process died); a FROZEN process (HyperOS) still
  serves its last row until it thaws. No Wi-Fi name, access point or address leaves the phone;
  when the red-pulse state flips it sends Halo the data-free `com.haroon.autopilot.CHANGED` ping.
  Shares: `packages/open-tunnel-core/src/shield-share.ts`.
- **store** (`apps/store`) — private Android sideload store (`docs/app-store.md`). Its "Setup and
  health" screen shows, per installed Store app, accessibility and notification access (read by
  the Store from Settings.Secure), the app's own `health` row (app-link-contract, validated by
  `parseHealthRow`, a second opinion only; a mismatch shows "not sure"), where its AI key comes
  from, and the HyperOS Autostart steps. The Store holds `com.haroon.permission.AUTOPILOT`
  (signature) only to read those rows; no personal data crosses. An app's row also shows
  "Build from commit <7 hex>" when the release recorded its commit (`android.commit` in the
  manifest), and hides the line when there is none.
- **pdf-editor** — offline PDF editor, moved in from `~/Documents/pdf-editor`
  on 2026-10-26: `apps/pdf-editor-desktop` (Electron), `apps/pdf-editor-mobile`
  (Expo + WebView), both booting the shared engine in
  `packages/pdf-editor-engine` (`build.mjs` inlines it for mobile). The mobile
  app's home screen is a searchable **Library** (folders, tags, full-text search,
  Arabic and Urdu normalised) over one `library.db`: logic in
  `packages/library-core`, app glue in `apps/pdf-editor-mobile/src/library`. Scan
  and Reader build on it; specs `docs/pdf-editor/`, progress `docs/handoffs/pdf-editor-scan.md`.
  The mobile app is named **Nexus** since N2 (package id and Store id unchanged): an opt-in
  AI layer over the same Library. AI runs through AI hub (`com.haroon.aihub`) only: Nexus has no
  keys, no provider and no key settings of its own, and nothing leaves the phone without AI hub.
  Through the hub, Gemini embeds text and reads images, Groq transcribes, and chat (graph, Ask,
  Minutes, CVs, receipts) goes to Groq or Gemini, whichever AI hub uses for chat; no OpenAI. Without AI hub installed, Nexus says "AI needs AI hub" with a button
  to the Store; if AI hub does not allow Nexus, "Allow Nexus in AI hub"; with no key there, "Add a
  key in AI hub"; a hub whose service fails or is offline pauses an item five times ("Waiting for AI hub to
  answer", with a Stream notice) without using up attempts, then counts attempts until it fails; a
  timeout always counts. Keys Nexus saved before are deleted from the phone only
  after the first successful hub chat or embed (a marker file records it).
  Logic is in `packages/knowledge-core`, glue in `apps/pdf-editor-mobile/src/nexus`. Design
  `docs/superpowers/specs/2026-11-18-nexus-design.md`, progress `docs/handoffs/nexus.md`.
  Long recordings: over 25 MB is planned by `planSource` into pieces under 90% of the upload
  limit with 2 s overlap, cut by the Android `audio-chunks` module without re-encoding (iOS has no
  cutter); Whisper on Groq returns segment times per piece, stitched onto the whole recording's
  clock; each piece result is saved on success to `library/<id>/transcribe/piece-<n>.json` so a
  retry resumes; pieces are deleted when the transcript is saved or the item is kept out of Nexus
  (keep-out also stops a transcription before its next piece). Meeting mode (Android only):
  `MeetingService` in `modules/audio-chunks`, a microphone foreground service recording AAC in
  ADTS (44.1 kHz mono 64 kbps) to `documents/meeting/recording.aac`; a kill or crash keeps what
  was written; no wake lock, START_NOT_STICKY; a stopped meeting with sound is offered as "Save
  the meeting you were recording?" and nothing is saved without a tap; a call or other app taking
  the mic is detected as silenced on Android 10+; HyperOS may kill it unless Nexus's battery saver
  is "No restrictions". Voice notes set `shouldPlayInBackground` while recording; a voice note
  killed mid-recording is lost (use Meeting).
  Minutes: made by `composeMinutes` (`packages/knowledge-core/src/minutes.ts`) only when the owner
  taps "Make minutes"; chat goes through AI hub (`ai.complete`; Groq or Gemini, whichever AI hub
  uses for chat; the consent copy says so), so the timed transcript lines are sent to Groq or Gemini. The transcript is untrusted (each segment `[seq] text` inside
  fences, delimiters neutralised); the model cites segment ids, the code keeps only ids it was
  shown and maps them to start times, uncited items are never stored; replies are validated and
  retried 3 times; long transcripts map-reduce over 10,000-character windows; stored in
  `kn_minutes`, cascade-deleted, removed by keep-out. Minutes text is appended to the item's
  Library search body and embedded (Gemini embeddings through AI hub, only when it is ready and the item is not kept out) as one
  chunk per summary, decision and action; making minutes re-queues the item at `embed` with
  `kn_jobs.embed_only`.
  Share to Nexus (Android only): `ShareActivity` (exported, SEND and SEND_MULTIPLE for pdf,
  text/plain, image/*, audio/*) in the audio-chunks module manifest copies each shared file into
  `files/shared-inbox/<id>/0..9`, then opens `pdfeditor://share?inbox=<id>`; the "Add to Nexus?"
  screen stores nothing until the owner taps Add; cancel deletes the copies, a start-up sweep
  deletes inboxes older than a day; caps 10 files per share, 100 MB per file, 250 MB per share;
  type from the first bytes as well as MIME; AMR, 3GP, raw AAC, WMA, GIF and video refused; audio
  over 25 MB must be M4A; links and text become notes and are never fetched.
  `ShareRules.sourceAllowed` refuses any scheme but `content://`, an authority missing or
  containing `@` or `:`, any of Nexus's own provider authorities (from
  `getPackageInfo(GET_PROVIDERS)`) or one that resolves to Nexus, and a descriptor whose real path
  (`/proc/self/fd`) is in Nexus's own dirs; `PdfScanFileProvider` serves only
  `cache/pdfscan-share/` and must never be widened. `classifyShared` and
  `intakeShared(payload, deps)` are the intake an action can call. Nexus cannot capture call audio
  (Android blocks it); it can import a recording another app saved. Offline OCR
  (`packages/text-ocr`, Tesseract4Android 4.9.0 Apache-2.0, English only) feeds nothing into Nexus
  today.
  AI hub only: Nexus sends every AI call (Gemini embeddings at 512 dimensions, Gemini image
  reading, Groq Whisper transcription with timed segments, and chat for the graph, Ask, Minutes,
  receipts and CVs, which AI hub sends to Groq or to Gemini) through AI hub via `ai-hub-client`.
  There is no own-key fallback. Not installed, Nexus not allowed, no key in the hub or a hub too old
  each show their plain notice and send nothing; an image over 7 MB is refused; an embedding reply
  that is not 512 dims of `gemini-embedding-001` pauses and tells the owner to set Embeddings in AI
  hub. Items kept out of Nexus are never sent.
  Ask my life, action items, receipts and shares (P3). Everything here is opt-in and OFF by
  default; every new data flow fails closed. Ask my life: Settings has three switches, Inflow
  messages (SMS and email, never one-time codes), Clipboard pinned clips and Deputy run history.
  Each also needs the other app's own switch ("Let Nexus read my messages", "Let Nexus read my
  pinned clips", "Let Nexus read my run history"); until then Nexus shows 'Off in <app>'. When on,
  Nexus reads through that app's signature-guarded share (nexus-links module,
  `AppLinkTarget.trustedProvider` before every query, a 3 s timeout, bad rows dropped, any refused
  or failed read deletes nothing), only while Nexus is open or in the foreground (no background
  service, at most 50 new items per source per run), and keeps a copy in `library.db` as a
  source-tagged item (shown read-only, labelled 'From Inflow message, 3 Nov', no Delete, Keep out
  still works). The text goes to Gemini for embeddings and, when the owner asks, the matching
  parts go to Groq or Gemini, whichever AI hub uses for chat, all through AI hub. Source items are
  embed-only (never graph extraction). All source text is untrusted and fenced in the Ask prompt.
  Never fetched: health data, one-time codes, Strongroom content. Turning a Nexus switch off
  deletes the items, chunks, vectors, search rows, graph, minutes and the read mark at once (a
  failed delete is retried on the next run or tap); turning the other app's switch off removes
  Nexus's copies the next time Nexus opens. Embeddings already sent cannot be recalled.
  Action items: 'Add to Inflow' (ADD_TODO) and 'Do with Deputy' (PROPOSE_TASK) appear on each
  Minutes action item and on the owner's own notes (not on items read from other apps). Per item,
  on a tap only, from an Activity via `startActivityForResult` with an explicit intent checked by
  `AppLinkTarget.trustedActivity`; never from a notification or a service. The other app shows
  its own screen first. ADD_TODO carries the item text (title at most 200, note at most 500,
  `dueAt` only from a real Nexus due date, `source` 'Nexus'). PROPOSE_TASK carries a fixed task
  sentence from Nexus and the item text (at most 2000) as untrusted `context`; Deputy's
  confirmation gate stays in front.
  Receipts: 'Read as receipt' sends the scan's first page to Gemini and the text read from it to
  Groq or Gemini, through AI hub, only on the owner's tap on the receipt screen (not for kept-out scans).
  Inflow payments from the `debits` share ('Let Nexus match my receipts', off in Inflow) are read
  only on 'Match to Inflow', matched on the phone (same amount, date within 3 days, fuzzy shop
  name, the owner confirms) and are never stored, logged, indexed into Ask or sent to any AI.
  'Remind me' asks Inflow for a to-do 14 days before the warranty ends, only on that tap.
  Shares Nexus serves on `com.haroon.pdfeditor.applink` to signed sibling apps only
  (`AppLinkCaller`, signature permission AUTOPILOT for read and write, no grant URIs, a query
  never writes): `today` (titles of the owner's own items due today, from `files/today.json`
  written by the app; opt-in 'Show what is due today in my other apps', OFF by default; never
  items read from other apps; Inflow shows only a count) and `health` (AI source hub or none,
  and when Nexus was last open; always served). `files/today.json` fails closed: switching off or
  a failed write removes it first. The nexus-links module is Android-only (null on iOS, no
  Swift); `kotlinx-serialization-json` 1.8.1 (Apache-2.0, the version ai-hub-client already
  ships) is an implementation dependency; no telemetry, no new third-party package;
  `allowBackup` is false.
- **design-editor** (`apps/design-editor`) — offline Canva-style editor for the
  Mac (Electron), moved in from `~/Documents/design-editor` on 2026-10-26.
  Its Android sibling `apps/design-editor-mobile` (`com.haroon.designeditor`, Store
  release id `design-editor`) runs the same canvas in a WebView plus the media tools
  as a Kotlin foreground queue (`modules/design-media`). Pure logic in
  `packages/media-core`. Specs: `docs/design-editor/`; progress:
  `docs/handoffs/design-editor-media.md`. Brand kit can pull dominant colours from an image the
  person picks (shrunk to 128 px on a canvas, median-cut in
  `packages/design-editor-engine/image-maths.js`); this runs entirely on the device and nothing
  is sent anywhere. On the phone, Design Editor is a share-sheet target for pictures and videos:
  what other apps send (JPEG, PNG, video; at most 20 items of 2 GB each) is copied into the app's
  own folder and checked by its real bytes, nothing is sent anywhere, and nothing is queued or
  changed until the person opens a tool on the "Add to Design Editor" screen. Design with AI (the
  layout chat) runs through AI hub only (`com.haroon.aihub`): the phone app has no AI key, no key
  screen and no provider of its own, and the hub holds the Groq or Gemini keys. What leaves the
  phone is the typed description and the page size, sent by the hub to Groq or Gemini,
  whichever AI hub uses for chat; the app never sees a key. When the hub is not installed, the
  app says "AI needs AI hub" with a button that opens the Store ("AI hub needs an update" with
  "Update AI hub" when it is too old); when the owner has not allowed Design Editor there,
  "Allow Design Editor in AI hub" opens the hub; when the hub has no key, "Add a key in AI hub".
  Busy, timeout and other failures are plain messages. Keys an older build saved are deleted only
  after the hub has returned a real reply to a Design with AI request on that phone (a marker file
  remembers it, so the deletion finishes on a later start); never on the hub merely answering, and
  never on a hub error. The Mac app `apps/design-editor` keeps its own keys. Nothing else in the app uses AI. App links: it serves only the `health` row at
  `com.haroon.designeditor.applink` (exported, AUTOPILOT permission for read and write,
  `AppLinkCaller.allowed` first, read-only, declared in
  `apps/design-editor-mobile/modules/design-media/android/src/main/AndroidManifest.xml`;
  `ai_source` from `files/ai-source.txt`, `last_seen_at` from a heartbeat written at app start,
  app to front and queue job end, never by a query). It hands things to other apps only on the
  owner's tap in a screen: "Send it with Deputy" starts `com.haroon.deputy.action.PROPOSE_TASK`
  with `startActivityForResult` (`task` is Design Editor's fixed sentence around the owner's own
  typed recipient and caption, at most 300 characters; `apps` is the one app the owner picked;
  `context` and `ref` are never sent), and Deputy's draft screen and confirmation gate decide;
  "Send to Nexus" shares 1 to 10 gallery photos (`ACTION_SEND_MULTIPLE`, read grants,
  `setPackage("com.haroon.pdfeditor")`, gallery image addresses only) to Nexus's share screen,
  which asks before it adds them. "Make a reel from my photos" searches, picks and renders on the
  phone; no photo leaves the phone through Design Editor itself. Free songs (the reel screen and
  the Video screen's Sound section) use Freesound over the network when the owner opens the
  panel: the search words and the owner's own Freesound key, kept in the app's private folder,
  go to freesound.org, and a chosen preview is downloaded.
- **deputy** (`apps/deputy`) — personal Android agent that carries out tasks by
  operating other apps through an AccessibilityService. Android only, private
  Store only (`com.haroon.deputy`). Kotlin owns the agent loop and the
  confirmation gate; RN only renders. Specs: `docs/deputy/` (PRD, SPEC);
  phases and spike results: `docs/handoffs/deputy.md`. Autopilot (stage 1): starts a
  reply run only from Inflow's Run tap, through `RunSuggestionActivity`, with the other
  person's text kept in the untrusted block; design `docs/superpowers/specs/2026-11-18-autopilot-design.md`.
  App links (`packages/app-link-contract`): `com.haroon.deputy.action.PROPOSE_TASK`
  (`ProposeTaskActivity`, signature permission AUTOPILOT, `AppLinkActivityCaller` first) only
  opens a draft; its `context` stays in the untrusted block and nothing starts without the
  owner's Start tap and the unchanged gate. Provider `com.haroon.deputy.applink` serves `health`
  to signed sibling apps always, `waiting` (names the owner gave only) only while "Share what is
  waiting with my other Haroon apps" is on, and `runs` (tasks the owner typed, state, time; never
  screen contents, steps or shared text) only to Nexus while "Let Nexus read my run history" is
  on; both switches are off by default. Text shared from other apps (share sheet, `text/plain`)
  becomes only a draft: the shared text is untrusted, kept apart from the owner's instruction
  (which starts empty), capped at 4,000 characters and sent to the model only in the untrusted
  block when the owner taps Start; a draft starts only from that tap, through the same
  `AgentRuntime.start` and the unchanged confirmation gate, and never runs, repeats or triggers
  anything by itself. Repeating tasks: the Repeating tab saves a task with a time and days, and
  WorkManager (`androidx.work`, Apache-2.0) starts it through the same entry point as the Run
  button (`AgentRuntime.start`, trigger `scheduled` in the run log). It starts only on an unlocked
  phone with the service on, a key saved and no task running. Otherwise that time is skipped with
  a "Run now" notification, and nothing queues or catches up. A scheduled run uses the same data
  as a typed task (the owner's task text, the screens it reads and route memory from past runs)
  and, like any run, sends it only to the configured model; nothing goes in the untrusted block.
  The confirmation gate is unchanged: every send, pay, delete or post waits for the owner's tap,
  and five minutes without one counts as no
  (`AgentLoopTest.aScheduledRunMeetsTheSameGateAsAManualRunAndNeverActsWithoutTheOwner`).
  Schedules live in `deputy-settings`, and their history (last 30, up to 30 days) in
  `filesDir/deputy/schedules/`. `ScheduledRun.PAYMENTS_ALLOWED` is an open owner decision: it is
  `true` on the branch, so a repeating task that reads like a payment still runs up to the gate.
  Deputy does not use AI hub yet: hub apiVersion 2 can't carry its steps (the chat reply leaves
  out the assistant message with Gemini's thought signatures, the default chat model can't read
  screenshots, and tool_choice can't be set), so every run uses the owner's own key; `ai_source`
  reports `own` when a key is saved, else `none`.
- **strongroom** (`apps/strongroom`) — personal password manager, all own code
  (Kotlin owns the vault; RN only renders). Android only, private Store only
  (`com.haroon.strongroom`). Design: `docs/strongroom/DESIGN.md`; phases:
  `docs/strongroom/PHASE-1-PLAN.md` and `docs/handoffs/strongroom.md`. Password check
  (Settings): Kotlin reads the unlocked vault's logins and flags weak passwords (plain rules),
  reused ones (in-memory hashes, never stored or logged) and ones on the bundled SecLists 10k
  list (MIT); only entry ids, flag kinds and counts reach JS, and nothing leaves the vault
  boundary or the phone. Expiry share (opt-in, off by default): while on, each unlock and change
  writes a small expiry index (card kind, label and end-of-month date only, sealed with the
  device Keystore key, readable while the vault is locked but not while the phone is) that a
  read-only app link (`content://com.haroon.strongroom.applink/expiry`, signature permission plus
  `AppLinkCaller`) serves to same-key sibling apps; labels are "Card" unless the owner picks Show
  names; never card numbers, codes, holders, notes, logins or pass data; turning it off deletes
  the index under the same lock the writer takes, so a sync in flight cannot bring it back. The
  provider also answers `content://com.haroon.strongroom.applink/health` (app id, null
  accessibility and listener, `ai_source` none, a heartbeat written when the app opens or
  autofill starts) to same-signed callers whatever the expiry switch says; it holds no personal
  data, only that Strongroom is installed and roughly when it last ran or filled (so a same-key
  sibling can tell when the owner last used it; Settings says this under Your other apps).
- **halo** (`apps/halo`) — edge visualizer: audio-reactive lights around the screen edge and
  an always-on display. It also carries Notch, the pill around the camera (`modules/notch-island`,
  fed by halo-engine's one notification listener; the separate `notch` app is gone). Android only,
  private Store only (`com.haroon.halo`); Kotlin modules `halo-engine` and `notch-island`, RN renders
  settings. Spec: `docs/superpowers/specs/2026-11-17-edge-visualizer-design.md`;
  plan: `docs/superpowers/plans/2026-11-17-halo.md`; handoff: `docs/handoffs/edge-visualizer.md`.
  The pill's progress ring, only while its switch is on, reads from other apps' notifications only
  the package name, key, isOngoing, whether visibility is secret, the post time and
  EXTRA_PROGRESS / EXTRA_PROGRESS_MAX / EXTRA_PROGRESS_INDETERMINATE, kept in memory only, never
  text; it shows a fraction only (lock screen included) and secret notifications never ring.
  Halo reads from the owner's other apps only while a matching switch under Home > Your other apps
  is on; all six are off by default and nothing leaves the phone. Red pulse: TunnelWall `shield` +
  `health` and HomeNet `new_devices`. Waiting pulse, always-on Waiting row and bubble: Inflow
  `suggestions` and Deputy `waiting`. Briefing: Inflow `briefing` (column `personal`, not
  `private`); HomeNet `who_is_home` only as a count, only with 'Show private briefing lines' (off
  by default), and shown only in Halo's in-app preview. Before each read Halo checks the
  provider's package and signer against a fixed owner table; any refusal, missing provider or
  timeout counts as no data. The always-on screen is the lock screen and fails closed: while
  locked it shows only Halo's own phrases built from counts ('N things are waiting', 'Briefing
  ready') and never any text from another app; source lines show only unlocked (Halo's in-app
  preview), private lines (medicine, steps) and the people-at-home count only with 'Show private
  briefing lines', and names of people at home never. Halo declares
  `com.haroon.permission.AUTOPILOT` (signature) and holds it, exports `ChangedReceiver` for
  `com.haroon.autopilot.CHANGED` behind that permission (no extras read; it only schedules a
  re-read: 5 s settle, at most once a minute), and exports `HaloLinkProvider` on
  `com.haroon.halo.applink` serving only `health` (accessibility, listener, ai_source none,
  last_seen_at heartbeat) behind the same permission and `AppLinkCaller`.
- **strongroom-extension** (`apps/strongroom-extension`) — Strongroom for Chrome
  (Manifest V3, Mac and Windows, loaded unpacked). Its own local vault in the
  Android vault format (`packages/strongroom-core`, checked against the shared
  `vault-vectors.json`); fills and saves logins; signs in to sync with the phone
  through the vault server (`tools/vault-api`, a Cloudflare Worker with D1 in the owner's
  account, deployed by `.github/workflows/deploy-vault.yml`; Strongroom 0.2.0 added the phone's
  side of sync). Handoffs:
  `docs/handoffs/strongroom-extension.md`, `docs/handoffs/strongroom-sync.md`.
- **inflow** (`apps/inflow`, formerly Notebox) — personal notification, SMS and
  money archive: saves every notification, the SMS inbox and marked Gmail senders'
  emails (IMAP with an app password) into an encrypted on-phone store (SQLCipher),
  reads bank SMS and emails into a spending ledger, and shows it behind a fingerprint
  lock, with AI summaries, importance, to-dos, money categories and an Ask AI tab
  through AI hub only (no key of its own; never sent: OTPs,
  blocked apps or senders, apps not recorded, items saved before the owner first turned AI on; Ask AI also sends ledger transactions of any age, with chat titles and a you/not-you flag per item; spending categories and the weekly/monthly reports send the fields of every transaction, including ones from bank pushes and from apps or senders kept from the AI, but never message text). POST_NOTIFICATIONS covers the reports (8 weekly, 4 monthly kept), medicine reminders and the daily summary.
  Android only, private Store only (`com.haroon.inflow`; READ_SMS, RECEIVE_SMS,
  INTERNET for `imap.gmail.com` only; AI goes through AI hub on the phone). Kotlin owns
  capture, storage, parsing, Gmail and AI; RN only renders. WhatsApp chats are grouped by contact, WhatsApp text is kept forever, and the media WhatsApp notifications expose is stored encrypted in the app's private files (never sent to the AI). Home is money card, Inbox (one row per chat-like app), Important (no payments), Coming up, Recent chats, All apps; Money has Overview, Reports and All. In an SMS contact list, senders the AI mostly reads as promotions (and no bank) fold into one "Promotions" row (nothing is deleted; the owner can override per sender; schema v7 `sender_promo`). Spec:
  `docs/superpowers/specs/2026-11-13-inflow-design.md`, `docs/superpowers/specs/2026-11-17-inflow-ux-design.md`; plans:
  `docs/superpowers/plans/2026-11-13-inflow-stage-*.md`, `docs/superpowers/plans/2026-11-18-inflow-ux.md`; progress:
  `docs/handoffs/inflow.md`. Autopilot (stage 1): turns what arrives into reply, bill, event and money suggestions with Run and Skip, shared with Deputy through a signature-guarded provider; design `docs/superpowers/specs/2026-11-18-autopilot-design.md`, progress `docs/handoffs/autopilot.md`. R44 has one exception: items from conversations the owner picked go to the AI for Autopilot only. Ask AI stays SMS and email only, plus health numbers when the owner turns that on, and the ledger and bank parsing take only SMS and Gmail items, not pushes from chat or other apps.
  Vitals (a Health section inside Inflow, not a medical device): steps, sleep and heart rate are
  read from Health Connect (read-only permissions READ_STEPS, READ_SLEEP, READ_HEART_RATE; no
  background read; refresh only while the app is open) and kept as daily totals in the encrypted
  store (schema v9 `health_daily`); medicines with reminders and a dose log (schema v10
  `medicines`, `dose_log`) and a symptom and mood journal (`journal`) live in the same store.
  Medicine reminders use the channel 'Medicine reminders', one inexact alarm, Taken, Skip and
  Snooze actions; the lock screen shows only 'Medicine reminder'. None of it leaves the phone
  except by two opt-in ways. (1) Doctor summary: only when the owner taps it, picks a range (at
  most 90 days) and sections, reads the exact text and taps Send, Inflow sends that text (daily
  steps, sleep, heart rate; medicines with dose, schedule and taken/skipped/missed counts;
  journal entries with date, mood, tags and note; only the ticked sections, at most 40,000
  characters) through AI hub (a chat job: Groq or Gemini, whichever AI hub uses for chat; the hub
  keeps only counts, never the text) with a fixed system prompt; the native side recomputes the text and refuses when its
  SHA-256 differs from the preview; nothing is sent on a schedule or in the background; the reply
  is cleaned and shown as plain text; the PDF is saved only where the owner picks in the system
  file picker. (2) 'Include health in Ask AI' (meta `healthInAsk`, off by default): when on, Ask
  gets only daily step, sleep and heart rate numbers and per-medicine dose counts without names
  for at most 31 days, never journal text or medicine names. Health, medicine, dose and journal
  data never reach the 30-minute AI batch, reports, categorisation, Autopilot suggestions or the
  Autopilot provider's suggestion rows, except two things that are built in code and carry no
  name or dose: the next medicine time and today's steps, as lines in the `briefing` share to
  Halo and in the morning summary, only while 'Include medicines and steps in my morning
  briefing' (meta `healthInBriefing`) is on, off by default. `HealthTables`, `HealthForAsk` and
  `VitalsSqlWiringTest` enforce the rest by construction (the briefing reaches health only
  through `StoreBriefingHealth`; the summary, the ping and the Nexus shares name no health code
  or table), and autopilot-contract has `NEVER_SHARE_DATA`. The connect-client library
  (Apache-2.0, no Play Services) adds guava, protobuf-lite and coroutines-guava. A short lock
  grace (2 minutes, `src/lockGrace.ts`) keeps the app unlocked only while a system picker or
  permission screen is open; on return it judges the time away and locks if it was 2 minutes or
  more.
  Links to the other apps (P2; nothing here adds a network flow from Inflow). The link provider
  `com.haroon.inflow.autopilot` runs `requireSibling()` first on every path (signature permission
  plus same key), and every path is read-only. Shares: `health` (one row, no personal data) to
  any same-key app; `briefing` ({line_id, kind, text, at, personal}, at most 20 lines of at most
  60 characters, built in code from structured data (bills and events by kind and date,
  yesterday's money out, counts or owner tags from HomeNet, Strongroom, Deputy and Nexus), never
  message text, served from a cached snapshot so a query never runs a reader) to Halo alone (the
  calling uid's only package is `com.haroon.halo`), only while 'Show my morning briefing in Halo'
  (meta `briefingShare`) is on; `ask_items/<sinceId>` and `ask_ids/<sinceId>` to Nexus alone
  (`com.haroon.pdfeditor`), only while 'Let Nexus read my messages' (`nexusAsk`) is on: SMS and
  email only, no one-time codes, nothing kept from AI, never Strongroom or Inflow items, only
  items saved after AI was first turned on in Inflow (never on means nothing), text cut at 4000
  characters, 200 rows a page, and Nexus sends what it reads to Groq or Gemini, whichever AI hub uses, through AI hub
  (the switch says so); `debits/<sinceId>` to Nexus alone, only while 'Let Nexus
  match my receipts' (`nexusDebits`) is on: money out from the last 60 days, newest 500, own
  transfers left out, `account` a label with at most the last four digits. Any other caller, or a
  switch that is off, gets an empty cursor. All five switches (these three, 'Include medicines
  and steps in my morning briefing', 'Morning and evening summary') are off by default. The legacy
  `items/#` read (one message's text for a Deputy run, only while a live reply suggestion names
  it) answers only a caller whose uid holds exactly `com.haroon.deputy`; any other signed sibling
  gets an empty cursor. ADD_TODO (`com.haroon.inflow.action.ADD_TODO`): an exported activity
  behind the signature permission; `AppLinkActivityCaller` first, then the fingerprint on every
  start, then a screen; one to-do is added only on the owner's Add tap and the note is shown, not
  saved. Summary ('Morning and evening summary', meta `digest`): at 08:00 and 20:00 an inexact
  alarm posts a 'Daily summary' notification (morning: the briefing lines; evening: today's spend
  and tomorrow's bills and meetings; at most 5 lines), re-armed after boot by a not-exported
  receiver (RECEIVE_BOOT_COMPLETED; the older reminders are not re-armed); if any shown line is
  personal (spent, medicine, steps, who is home) it is `VISIBILITY_SECRET` and shows nothing on a
  secure lock screen, otherwise `VISIBILITY_PRIVATE` with a public version that holds only a
  count. CHANGED ping: the data-free `com.haroon.autopilot.CHANGED` broadcast to `com.haroon.halo`
  only (explicit, no extras, permission AUTOPILOT), sent when the briefing lines or the waiting
  suggestions change, at most once a minute, only after `AppLinkTarget.trustedReceiver`. Pay with
  Deputy: a button on a waiting bill that starts Deputy's `PROPOSE_TASK` draft with
  `startActivityForResult` (explicit intent, `AppLinkTarget.trustedActivity` first); it sends a
  fixed task sentence, the payee's saved name or sender in `context` only, the due date and the
  suggestion id, and no amount; Deputy starts nothing until the owner taps Start, and its
  confirmation gate is unchanged. Reader and sender rule (`AppLinkTarget`): before each read of
  another app's share (HomeNet `who_is_home`, Strongroom `expiry`, Deputy `waiting`, Nexus
  `today`; 2 s deadline, rows validated, failures skipped silently) Inflow calls
  `trustedProvider`, and before each start or broadcast `trustedActivity` or `trustedReceiver`;
  `SiblingTrustWiringTest` fails on a broadcast, bind or service start without it. Shares:
  `packages/autopilot-contract/src/inflow-shares.ts`.
  AI hub only (owner decision 2026-11-24; this replaces E2's hub-first with an own-key fallback and R44's
  'Inflow AI needs its own key'): Inflow has no AI provider, API key, model, effort or address of its own and
  no key settings screen. The 30-minute batch (summaries, importance, to-dos, money and Autopilot suggestions),
  spending categories, the weekly and monthly reports, Ask AI and the Doctor summary all go to AI hub
  (`com.haroon.aihub`) as chat jobs through `ai-hub-client`, with exactly the text R44 already allows; the hub
  uses Groq or Gemini, whichever AI hub uses for chat (the owner can move chat to Gemini, and it also moves on to Gemini when every Groq key is rate-limited or missing), and keeps only counts. 'Use AI' in Settings
  is the owner's opt-in (the old 'a key is saved'): it sets aiSince the first time, and only items saved from
  then on are sent; a phone that had a key for the address its old model picker had chosen (Google's by default) stays on, any other stays off. Without the hub the screens say, in plain words with one
  button each: 'AI needs AI hub.' (Install AI hub opens the Store, which has no page link for one app), 'Allow
  Inflow in AI hub.' and 'Add a key in AI hub.' (Open AI hub), 'AI needs a newer AI hub.' (Update AI hub); no hub
  error text reaches a screen and a hub that is not ready keeps the queue and the report's tries. Keys saved
  before this change are deleted from `ai_keys` only after the first SUCCESSFUL hub chat (a real reply) on the
  phone, never on `available()` alone and never after a hub error; a stored marker (`aiHubWorked`) makes the
  cleanup run again at every start. A hub reply that names a model Inflow does not price counts at the
  dearest known price toward the daily limit. Health text (privacy-relevant change, owner to confirm): the
  Doctor summary (on the owner's tap, after the preview) and Ask AI with 'Include health in Ask AI' on now go
  through the hub, so the text reaches Groq or Gemini, whichever AI hub uses for chat; both switches stay off
  by default with consent copy 'Your health text goes to Groq or Gemini, whichever AI hub uses for chat,
  through AI hub. AI hub keeps only counts, never the text.' plus the free-tier Gemini warning (Google may
  use what Inflow sends to improve its products; billing avoids that), restored from the old key panel and also
  shown under 'Use AI'. The background batch, categories and reports never carry health text (`HubRoutingTest`,
  `AskRunTest`). The health row's `ai_source` is `hub` while AI is on and `none` while off.

- **clipboard** (`apps/clipboard`) — the owner's own clipboard history, replacing Gboard's
  1-hour delete. Android only, private Store only (`com.haroon.clipboard`). An
  AccessibilityService (`CaptureService` in `modules/clipboard-core`) saves copies in the
  background; a draggable bubble, shown only while the keyboard is open, pastes a clip into the
  focused field; swipe deletes with Undo. Clips are kept 7, 30 (default) or 90 days or 1 year,
  one-time codes 10 minutes (pinned or not), other pinned clips until deleted. Smart actions: a
  text clip's row offers Open link (http/https), Call (dialer only, never places a call), Open
  map, Track parcel (the carrier's public page in the browser) and Copy IBAN (mod-97 checked),
  recognised on the phone only when the row is drawn, never for passwords, codes or clips marked
  sensitive, and run only on a tap; the tapped link, number, tracking number or address goes to
  the browser, dialer or map app. A recognised IBAN also offers Add to Inflow: it opens Inflow's
  `ADD_TODO` screen with `startActivityForResult` (title "Pay account" plus the IBAN, note "From
  Clipboard"), and Inflow adds nothing until the owner taps Add there. Links
  (`packages/app-link-contract`, provider `ClipLinkProvider` on `com.haroon.clipboard.applink`,
  signature permission AUTOPILOT): `health` (accessibility on/off, no listener, no AI, a
  heartbeat) for same-key apps; `pinned` (`{id, text, pinned_at, from_app}`, pinned text clips
  only; clips an app marks as passwords or sensitive, one-time codes (a clip that is only 4 to 8
  digits), images and files never go, but a password copied from a web page or a code inside a
  longer message is stored as plain text and goes if pinned, which is why the setting says not to
  pin a password; text up to 2000 characters, 200 rows, paged by `pinned/<sinceId>`) served only
  to Nexus (`com.haroon.pdfeditor`, checked by calling package) and only while "Let Nexus read my
  pinned clips" is on (off by default). This is the one route from Clipboard to an app with
  internet: Nexus may send those clips to AI (Gemini embeddings, Groq answers) when the owner
  turns on Ask my life. No INTERNET permission in release (debug only, for Metro). Kotlin owns
  capture, storage, expiry and the shares; RN only renders. Design: `docs/clipboard/DESIGN.md`;
  progress: `docs/handoffs/clipboard.md`.
- **ai-hub** (`apps/ai-hub`, shown as "AI hub") — the one place on the phone where AI is
  configured: Gemini and Groq keys (several per service, hand-over to the next key, sealed with
  an Android Keystore key), a model per job, an on/off switch per app, and a
  signature-protected bound service that Store apps call. Android only, private Store only
  (`com.haroon.aihub`, Store id `ai-hub`, brand `aihub`). Kotlin owns logic
  (`modules/ai-hub-core`); RN only renders. No OpenAI, no Anthropic, no local LLM. The service
  is guarded by the signature permission `com.haroon.permission.AI_HUB`; `Callers.identify`
  checks every call. Keys never leave the hub: there is no API that returns a key, and none may
  be added. Unknown apps are denied by default; a same-signed app is served only after the owner
  turns it on in the hub, and a refused app is listed as pending (package and last time only, at
  most 20). Strongroom is always refused. The hub keeps per-app counts (calls, tokens, last used)
  and a per-call log of app, job, service and time (never prompt, reply or key; newest 200; the
  owner can clear it; whether it stays is the owner's call). Apps use it through
  `packages/ai-hub-client` (Kotlin `AiHubClient` plus TS `aiHub`; the AIDL copy is checked byte
  for byte against the hub's), keep their own key as a fallback on `hub-missing`, `not-allowed`,
  `version` and `no-key`, and never log prompts or replies. Request contract `apiVersion` 2
  (embed `dimensions`, transcribe `segments`); version 1 requests still work. Callers today:
  Nexus, Inflow and Design Editor (phone); Deputy does not call it. Plan: `docs/ai-hub/PLAN.md`;
  progress: `docs/handoffs/ai-hub.md`.
- **sieve** (`apps/sieve`) — the owner's ad blocker for Chrome (Manifest V3), sold through
  the Chrome Web Store (release state in `docs/handoffs/sieve.md`). Filter compiler and
  settings logic in `packages/sieve-core`; how to install and what is verified in
  `apps/sieve/README.md`. Design: `docs/superpowers/specs/2026-11-06-sieve-design.md`;
  plan: `docs/superpowers/plans/2026-11-06-sieve.md`; progress: `docs/handoffs/sieve.md`.
- **autonomous-browsing** (`apps/autonomous-browsing`) — Electron desktop app for
  chat-authored browser automation routines, copied in from
  `~/Documents/browser-automation` on 2026-11-17 (tracked files only, no git
  history; the original stays standalone). A normal pnpm workspace member now; its
  `CLAUDE.md`, `README.md` and `AI_CONTEXT.md` use `pnpm --filter autonomous-browsing <script>`;
  its other docs (`ARCHITECTURE.md`, `evals/`, `docs/`) may still say `npm run`, read that the same way.
  It also has a dry run: `Dry run` next to `Run` walks a routine without acting. `classifyStep`
  (`src/shared/dry-run.ts`) labels each step kind read-only or mutating, and any kind it does not
  list counts as mutating and is skipped. `guardSession` (`src/main/automation/dry-run.ts`) wraps
  the session so a mutating step, or a hold for a person, throws `DryRunBlockedError`. For each
  step the walk looks the target up with a read-only assert and takes a screenshot through the
  existing `snapshot()`. The report (`report.md` plus `step-N.jpg`) is written to
  `userData/dry-runs/`. It leaves out typed text, chosen values and URL queries, makes no model
  call, and nothing leaves the machine. `navigate` is skipped, so the start page must already be
  open. Tests: `tests/dry-run.test.ts` (vitest, no Electron).

- **text-ocr** (`packages/text-ocr`) — Expo local module shared by Design Editor mobile and
  PDF Editor: Tesseract (English, bundled `tessdata_fast`) plus a clipboard copy, Android only.
  Design Editor: long-press an image, "Copy text" (bridge event `recognizeText`). PDF Editor:
  "+" → "Scan text" (`app/scan-text.tsx`, system camera through expo-image-picker). The Scan
  branch's Phase 4 OCR in `pdf-scan` is separate and unchanged.
- **app-link-contract** (`packages/app-link-contract`) — how apps read from or start things in
  each other: typed read-only shares (`defineShare`) and actions that always show a screen
  (`defineAction`), both guarded by the one signature permission `com.haroon.permission.AUTOPILOT`.
  `packages/autopilot-contract` is built on it. Providers call `AppLinkCaller.allowed` (permission
  plus the same signing certificate); an action calls `AppLinkActivityCaller.allowed(activity)`
  first (calling package set and same certificate), which only passes when the caller used
  `startActivityForResult` from an Activity, so buttons that start another app's action live in
  app screens, never in notifications or services (a Deputy run can never start one). The Kotlin
  `AppLinkGuard`, `AppLinkCaller` and `AppLinkActivityCaller` are copied into each app's module
  with only the `package` line changed and `copies.test.ts` fails on drift. Declared links:
  `PROPOSE_TASK` (Deputy draft screen; `context` is untrusted and goes only in the untrusted
  block), `ADD_TODO` (Inflow), each app's one-row `health` share (`appHealthShare`: accessibility,
  listener, `ai_source` hub/own/none, a heartbeat the app writes; no personal data; the Store
  trusts Settings.Secure first) and the data-free `com.haroon.autopilot.CHANGED` ping to Halo only
  (no extras; Halo re-reads the shares). No secrets cross; other people's text is untrusted data
  in the receiving app and never skips Deputy's confirmation gate. Deputy's
  `RunSuggestionActivity` is the one grandfathered headless action; new ones must show a screen.
  Every app that reads another app's share must call `AppLinkTarget.trustedProvider` before each
  query, and every app that starts another app's activity or sends it a broadcast must make the
  intent explicit and call `AppLinkTarget.trustedActivity` or `AppLinkTarget.trustedReceiver`
  first. A false result means not installed: never query, never send, never fall back to an
  implicit intent. Each such app copies `packages/app-link-contract/android/AppLinkTarget.kt` and
  `AppLinkTargetTest.kt` in, changing only the `package` line, and declares `<queries><package>`
  for each sibling it reaches. Links hold only between Store-signed releases (debug builds are not
  on the shared key). How-to, threat model and phone checks:
  `packages/app-link-contract/README.md`.

Not here on purpose: `~/Documents/agent-harness` (deferred until its phase
branches are merged).

Planned (do not scaffold yet):
- macOS/Windows targets for NetLens (react-native-macos / Electron) — future scope.

## Shared UI (`packages/ui`, NEVER hand-roll colours or fonts in an app)
- Every app uses `@apps-hub/ui`. React Native: wrap the root in
  `<ThemeProvider brand="…">` and build screens from its components (`Screen`,
  `Header`, `Group`/`Row`, `Button`, `Field`, `Segmented`, `TabBar`, `Readout`,
  `Notice`, `Sheet`, …). HTML/Electron: load `web/tokens.css` + `web/base.css`
  and set `<html data-brand="…">`; use the `--c-*` variables and `.ui-*` classes.
- Tokens live in `src/tokens.ts` only. After changing them run
  `pnpm --filter @apps-hub/ui build:css`; the test fails if `web/tokens.css` is
  stale, and it enforces WCAG AA contrast for every brand in light and dark.
- Brands: netlens, opentunnel, store, pdf, design, deputy, strongroom, inflow, clipboard, halo, sieve, aihub (hue + accent from each
  launcher icon). Light and dark follow the system.
- Copy is sentence case, active voice; errors say what happened and how to fix
  it. No emoji icons, no ALL-CAPS labels.
- Fonts: Atkinson Hyperlegible Next + Mono (OFL, vendored in `packages/ui/fonts`).

## Tech Stack & Toolchain
- React Native 0.81.x + Expo SDK 54 + TypeScript 5.9.x (version-pinned to the
  stack proven in the pdf-editor mobile app).
- Node ≥ 22 (nvm), package manager: **pnpm** (pinned in root `package.json`
  `packageManager` field, enabled via `corepack enable pnpm`).
- Metro/monorepo: `node-linker=hoisted` (see root `.npmrc`) + `watchFolders` /
  `nodeModulesPaths` config in each app's `metro.config.js`.
- Android builds: JDK 21 (`$JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`)
  + Android SDK (`ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`,
  platform-tools, platforms;android-36, build-tools;36.0.0).
- iOS builds: Xcode + CocoaPods (`pod install` in `apps/netlens/ios`,
  `apps/open_tunnel_vpn/ios`).
- Local DB (when Phase 3 starts): `expo-sqlite` (pure FOSS). OpenTunnel's
  cache already runs expo-sqlite (schemaVersion 1).

## Hard Architectural & OS Constraints — NetLens (NEVER VIOLATE)
1. **NO ARP TABLE SCRAPING:** Never read `/proc/net/arp`, never shell out to
   `ip neigh`. They fail with `EACCES` on Android 11+ and iOS. Host discovery
   is TCP-probe based only.
2. **TCP RST = HOST ALIVE:** In the TCP probe engine, `ECONNREFUSED` /
   `ConnectException` (connection refused) means the target IP is ONLINE and
   actively responded with a TCP RST. It MUST be classified as
   `isReachable = true` WITH the measured RTT. Only `SocketTimeoutException`
   (ETIMEDOUT) or `NoRouteToHostException` (EHOSTUNREACH/ENETUNREACH) means
   offline. This rule is enforced natively (Kotlin + Swift) and guarded by
   unit tests (`TcpProbeClassifierTest`).
3. **CONCURRENCY:** All subnet sweeps are bounded. Android: Kotlin
   `Semaphore(64)`. iOS: a fixed pool of 64 worker queues pulling from a shared
   cursor. Never launch 254 unthrottled socket operations simultaneously.
4. **MULTICAST LOCK:** On Android, always acquire `WifiManager.MulticastLock`
   before mDNS/SSDP discovery and release it in a `finally` block.
5. **F-DROID PURE FOSS:** Never add proprietary dependencies (no Firebase, no
   Google Play Services, no closed-source SDKs, no telemetry/crash-reporting).
   Audit licenses before adding any dependency (Expo, React Native,
   expo-modules: MIT).
6. **MODERN ANDROID APIS:** Use `ConnectivityManager.getActiveNetwork()` +
   `getLinkProperties()` for IP/Gateway detection. Never use deprecated
   `WifiManager.getConnectionInfo().ipAddress`.
7. **DEFAULT PROBE PORTS:** `[80, 443, 22, 445, 5353, 8080, 62078]` with a
   350 ms connect timeout per probe. Subnet sweeps are clamped to at most a
   `/24` around the host IP (NFR-1).

## Code Style & Workflow
- NetLens feature specs: `docs/netlens/PRD.md` (FR-1..FR-4, NFR-1..NFR-3
  acceptance criteria AC-1..AC-4), `docs/netlens/SPEC.md` (architecture,
  native module contracts, algorithms), `docs/netlens/PROMPTS.md` (phase
  prompts — execute one phase per session, strictly in order 1 → 4).
- Shared TS logic goes in `packages/core` (pure TypeScript, runnable from RN,
  Electron, or Node — no React/RN imports there).
- Native per-platform code lives in Expo local modules under the app
  (`apps/netlens/modules/netlens-core`) via Expo Modules API.
- Tests: TypeScript via `node --test` (type stripping, no Jest dependency).
  Native invariants via Gradle JVM unit tests
  (`:netlens-core:testDebugUnitTest`).

## Verification Commands (per phase; report ACTUAL output, never predicted)
```bash
pnpm test                       # all workspace package unit tests (TS)
pnpm typecheck                  # tsc --noEmit per package
# Native engine compile + unit tests:
cd apps/netlens/android && JAVA_HOME=$JAVA_HOME ./gradlew \
  :netlens-core:testDebugUnitTest :app:assembleDebug
cd apps/netlens/ios && xcodebuild -workspace NetLens.xcworkspace -scheme NetLens \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -configuration Debug build CODE_SIGNING_ALLOWED=NO
# Native compile gate (OpenTunnel, after Phase 2+):
cd apps/open_tunnel_vpn/android && JAVA_HOME=$JAVA_HOME ./gradlew :app:assembleDebug
# Native compile gate (Deputy):
cd apps/deputy/android && JAVA_HOME=$JAVA_HOME ./gradlew \
  :deputy-agent:testDebugUnitTest :app:assembleDebug
# Native compile gate (Strongroom):
cd apps/strongroom/android && JAVA_HOME=$JAVA_HOME ./gradlew \
  :strongroom-vault:testDebugUnitTest :app:assembleDebug
# Native compile gate (Inflow):
cd apps/inflow/android && JAVA_HOME=$JAVA_HOME ./gradlew \
  :inflow-core:testDebugUnitTest :app:assembleDebug
# Native compile gate (PDF Editor mobile; the Scan module's JVM tests):
cd apps/pdf-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew \
  :pdf-scan:testDebugUnitTest :app:assembleDebug
# Native compile gate (Halo):
cd apps/halo/android && JAVA_HOME=$JAVA_HOME ./gradlew \
  :halo-engine:testDebugUnitTest :notch-island:testDebugUnitTest :app:assembleDebug
# Native compile gate (Design Editor mobile):
cd apps/design-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew \
  :design-media:testDebugUnitTest :app:assembleDebug
# Sieve (Chrome extension; the e2e opens headless Chrome for Testing in a temporary profile):
pnpm --filter sieve build && pnpm --filter sieve test:e2e
node apps/sieve/test/perf.mjs   # about 10 minutes (one full run on 2026-11-08 took 9 min 48 s); allow up to 30 minutes, the hard timeout; real sites, needs the machine otherwise idle
# Electron apps (open real windows, so not part of `pnpm test`):
pnpm --filter pdf-editor-desktop test:e2e   # desktop + Electron + mobile-bridge suites
pnpm --filter design-editor test:e2e
# Chrome extension in real Chromium (build first; needs playwright-core, see its README):
pnpm --filter strongroom-extension build && pnpm --filter strongroom-extension test:e2e
# Environment sanity:
pnpm doctor                     # expo-doctor in every app that ships it
```
