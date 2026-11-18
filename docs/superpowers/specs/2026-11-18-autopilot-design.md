# Autopilot: Inflow, Deputy, Halo and Design Editor working together

Date: 2026-11-18. Status: builder check done and answered; waiting for the owner's approval.
Working name "Autopilot" (placeholder; the owner can rename it). Handoff: `docs/handoffs/autopilot.md`.

## 1. Intent and why

The owner's phone already has four of their own apps that each do one thing well, and none of them talk:

- **Inflow** (`com.haroon.inflow`) reads everything that arrives (notifications, SMS, marked Gmail), keeps a bank
  ledger and runs an AI pass that labels each item and pulls out to-dos with due times.
- **Deputy** (`com.haroon.deputy`) operates other apps through accessibility and asks before anything irreversible.
- **Halo** (`com.haroon.halo`) owns the screen edge and the always-on screen (AOD), and can draw over apps.
- **Design Editor** (`com.haroon.designeditor`) makes graphics on the phone and shares them.

The owner wants these to work together so the phone notices what needs doing and gets it ready, and so that
doing it is fun. In the owner's words: "make my life much easier, fun based and interesting".

Autopilot means: **Inflow spots something to do, Autopilot prepares it, the owner taps once to start it.**
Halo shows that something is waiting, and a creature on the always-on screen grows when chores get done.

## 2. What the owner decided (2026-11-18, multiple-choice answers)

| Question | Answer |
|---|---|
| First direction | Autopilot (detect → prepare → one tap) |
| What it catches | All four: bills and due dates, requests in chats, meetings and to-dos, money surprises |
| How a suggestion reaches the owner | All four: edge pulse (and AOD), notification card, floating bubble, daily digest |
| Where the fun shows | All four: edge and AOD, shareable cards, phone recolours itself, a creature |
| Creature | Feeds on done chores and no-spend days; gets hungry when suggestions pile up; wallpaper colour follows its mood |
| Sharing between the owner's apps | **Full text** may cross between the owner's own apps (on the phone) |
| Deputy's freedom | **Suggest, I tap.** Nothing starts without the owner's tap; Deputy's gate still applies inside the run |
| Which apps in the build | All four (Inflow, Deputy, Halo, Design Editor) |
| Where the brain lives | **Inflow** (approach A below) |
| Speed for chat requests | **Within a minute**: chats go to the AI on arrival; bills and money keep the 30-minute batch |
| Inflow's ruling R44 (only SMS and email reach the AI, 2026-11-16) | **Amended: chats from people I pick.** WhatsApp/Telegram chats with contacts or groups the owner picks go to the AI for Autopilot only. Everything else stays SMS and email only; Ask AI is unchanged |
| Inflow's fingerprint lock on Autopilot surfaces | **Phone lock is enough.** Run and Skip work from the notification and the bubble once the phone is unlocked |

## 3. Goals

1. **G1. A private channel between the owner's apps.** Only apps signed with the shared apps-hub release key
   (cert SHA-256 `e3af4a92…`, `docs/app-store.md`) can use it. Nothing like it exists today: no app declares a
   custom permission or exports a provider; apart from launcher activities and the open `designeditor://`,
   `pdfeditor://`, `netlens://` and `opentunnel://` links, no app can be started by another.
2. **G2. Suggestions in Inflow.** Inflow turns what arrives into a list of suggestions, each with a short title,
   the reason (the source item), an action and a state (`waiting`, `started`, `done`, `skipped`, `expired`).
   Four kinds:
   - **Bill or due date** ("K-Electric PKR 4,200 due on the 25th") → a reminder at a sensible time, and an action
     that opens the bank or biller app when due.
   - **Chat request** ("Ali: send me the clinic address", "what time tomorrow?") → an action that has Deputy find
     the answer and draft the reply in the same chat; Deputy's gate shows the text before it sends.
   - **Meeting or to-do with a time** ("Kal meeting 11 baje") → a calendar event and/or alarm.
   - **Money surprise** (an unusual debit, a large debit, money in from a new name) → "check it" action that
     opens the bank app (read-only for Deputy, as its trust table already says).
3. **G3. Fast path for chats.** Messages from messaging apps go to Inflow's AI within about a minute of arrival
   (batched over a short window), not on the 30-minute schedule. Everything else stays on the 30-minute batch.
4. **G4. One tap to start.** Tapping Run on any surface starts the action. Where Android has a built-in way to do
   it (calendar insert, set alarm, open an app, open a link), Autopilot uses that directly. Deputy is used only
   when an app has to be operated (finding information, drafting and sending a reply).
5. **G5. Four ways to see it.**
   - Notification card from Inflow with Run and Skip.
   - Edge pulse from Halo in an Autopilot colour while anything is waiting, and the waiting suggestions on the AOD.
   - Floating bubble from Halo that opens the waiting list over any app.
   - Daily digest: one notification in the morning and one in the evening listing what's waiting.
6. **G6. The creature.** A creature lives on a Halo AOD face and in Halo's app. It is fed by suggestions the owner
   finished and by no-spend days (from Inflow's ledger), and gets hungry when suggestions sit unanswered. Its mood
   sets a colour.
7. **G7. The phone recolours itself.** Halo makes a wallpaper from the creature's mood colour and sets it, so
   Android's own colour theming (Material You) follows the creature. Off by default; the owner turns it on.
8. **G8. Shareable cards.** From Inflow's weekly and monthly reports (which already exist) and the creature's
   week, Design Editor opens a ready-filled card the owner can tweak, export and share.

## 4. Non-goals

- Anything starting without the owner's tap (owner: "Suggest, I tap").
- Paying, transferring or buying from a suggestion. A bill suggestion opens the app; paying stays a manual step or
  goes through Deputy's normal per-app trust (banking apps are read-only in Deputy by default).
- iOS.
- New AI providers. Inflow and Deputy keep their own configured OpenAI-compatible providers and keys.
- Other apps (Clipboard, HomeNet, TunnelWall, Strongroom, PDF) in this build. The channel is designed so they can
  join later; HomeNet "new device on Wi-Fi" and TunnelWall "tracker contacted" on the edge are listed as later
  ideas only.
- Model Host (on-device models): its decision is still open; Autopilot uses the cloud models already configured.
- Design Editor rendering cards in the background. Cards open in the editor for the owner.

## 5. Anti-goals (a failure even if it works)

- **Anything runs without a tap.** No surface may start a Deputy run or a system action by itself.
- **The channel is open to other apps.** Any app not signed with the owner's key reading Inflow text, starting a
  Deputy run or driving Halo is a security failure.
- **Text crosses that Inflow promised never to send.** Items blocked from AI, OTPs, and anything from Strongroom
  or Inflow itself never go through the channel, because Deputy sends what it reads to its cloud model.
- **Private text on the lock screen.** The AOD and the edge are visible to anyone holding the phone.
- **Nagging.** The owner gets more interruptions than help. One suggestion produces at most one heads-up
  notification; the rest is quiet (edge, bubble, digest).
- **Battery drain.** No new always-awake loops; Halo's idle rule (no frames when nothing animates) still holds.
- **Double counting or duplicate suggestions.** The same bill arriving by SMS and email is one suggestion.

## 6. Constraints

- AGENTS.md rules: no proprietary SDKs or telemetry, licences audited, erasable TypeScript, each test file listed
  in its `package.json`, `@apps-hub/ui` for every screen, plain sentence-case copy.
- Kotlin owns everything in the background in all four apps; React Native only renders (the existing pattern).
- Deputy's safety rules (`docs/deputy/PRD.md` §5) are unchanged: the gate is native, notification text is data
  and never lowers policy, approvals are single-use. A run started from a suggestion is a normal run with its own
  `allowedApps`.
- Inflow's rules are unchanged except R44: original text never modified, blocked items and OTPs never sent to AI,
  the daily AI spend cap (default $0.50) applies to the fast path too. R44 (`core/AiChannels.kt`,
  `SqlItemStore.NEVER_SEND_FILTER`, `Ingest.queueForAi`, `AiFilterTest`) gains one exception: items from
  conversations the owner picked for Autopilot. Ask AI's item and transaction filters stay SMS and email only, and
  a test proves a picked WhatsApp chat still never reaches Ask AI.
- Halo's rules are unchanged: edge overlays are non-touchable, the AOD never dismisses the keyguard, Halo has no
  INTERNET permission in release.
- Installed only through the private Store. Inflow, Deputy and Design Editor releases need the owner's go; Halo
  releases are pre-approved. Phone tests follow the coord device queue.
- **Branch timing (my call):** Inflow's newest work is on `inflow/post-release` (built, not pushed, not on the
  phone) and Halo's on `halo`, with a Halo stage 5 plan waiting for the owner. Stage 1 of Autopilot touches Inflow
  and Deputy only, so it starts from `main` once `inflow/post-release` is merged. Stage 2 (Halo surfaces) starts
  after Halo's branch, including stage 5 if the owner approves it, is merged, because both change Halo's edge
  events and settings codec.
- Android limits that shape the plumbing: manifest receivers don't get implicit broadcasts (so every message is
  sent to an explicit package); starting a foreground service from the background is restricted (so Deputy's run
  starts from the owner's tap, through a `PendingIntent` that opens Deputy); a custom permission must be declared
  by an installed app before another app can use it (so every participating app declares it).

## 7. Approaches (owner picked A)

- **A. Inflow is the brain (picked).** Inflow already reads everything, runs the AI and stores to-dos, so it also
  stores suggestions and decides them. Deputy runs actions, Halo shows them and hosts the creature, Design Editor
  makes cards. No new app, no new permissions beyond the channel. Cost: Inflow's AI needs a fast path for chats.
- **B. A new small Autopilot app as the hub.** Clean ownership of suggestions, digest and creature, but a tenth app
  with its own setup, and it would have to copy or keep asking Inflow for data. Rejected.
- **C. Deputy is the brain.** Deputy reads Inflow's messages and decides with its own model. Every candidate
  message costs a cloud call, and Deputy is built around runs, not watching all day. Rejected.

## 8. Design

### 8.1 The channel

- A signature permission `com.haroon.permission.AUTOPILOT` (`protectionLevel="signature"`), declared with the same
  definition in all four apps' manifests, so install order doesn't matter.
- **Inflow exports one content provider** (authority `com.haroon.inflow.autopilot`, read and write permission
  `com.haroon.permission.AUTOPILOT`) with:
  - `suggestions`: id, kind, title, reason, source item id, action, state, created/due/updated times.
  - `suggestions/<id>` update: state changes (`started`, `done`, `skipped`) from Deputy, Halo or Inflow.
  - `items/<id>`: the full source item (app, sender, conversation, text, time), for Deputy when it starts a run.
    Refuses items from apps blocked from AI, OTP items, Strongroom and Inflow.
  - `creature`: the creature's current state (§8.5).
- **Change messages:** when suggestions or the creature change, Inflow sends an explicit broadcast
  (`com.haroon.autopilot.CHANGED`) to Halo's package only, with receiver permission AUTOPILOT. Halo then
  reads the provider. The broadcast itself carries no text.
- **Starting Deputy:** Deputy exports one activity `RunSuggestionActivity`, guarded by AUTOPILOT, taking a
  suggestion id. It reads the suggestion and its item from Inflow's provider, builds the task and allowed apps
  (§8.3), shows a one-screen "Starting: Reply to Ali on WhatsApp" with Stop, starts the normal run and finishes.
  Run outcome is written back to `suggestions/<id>`.
- **Deputy's trust boundary (builder check):** Deputy's prompt treats only the task text as the owner's
  (`core/Prompt.kt`, SPEC §10). So the task text Autopilot builds is written by code from fixed templates and
  holds only names, the app and dates. The other person's message goes in a separate untrusted block, like
  Deputy's existing notification block. This needs one new parameter on `AgentRuntime.start` (a list of untrusted
  context strings), plus a test that text in that block can't change allowed apps or the gate.
- **Open links stay open:** `designeditor://` is BROWSABLE and any app can open it. The card link carries only
  numbers and short labels, so that's acceptable; the permission does not guard it.
- **Design Editor:** a deep link `designeditor://card?kind=week|month&...` opens the card template filled with the
  numbers passed in the link (numbers and short labels only; no message text).
- **Shared contract:** the provider's column names, the action JSON and the creature JSON live in one small
  package (`packages/autopilot-contract`: a TS description and JSON fixtures). Each app's Kotlin reads the same
  fixtures in its JVM tests, as Halo already does for its settings, so the four apps cannot drift.

### 8.2 Finding suggestions (Inflow)

- **AI:** Inflow's existing per-item AI reply (`core/Ai.kt`) gets one more optional field per item,
  `suggest`: `{ "type": "reply|bill|event|none", "due": "YYYY-MM-DDTHH:MM"|null, "detail": "..." }`.
  The model only describes; Inflow decides whether it becomes a suggestion (rules below), and the parser rejects
  anything malformed, as it does today.
- **Picked chats:** in Autopilot settings the owner picks contacts and groups (from Inflow's existing per-app
  contact lists) whose WhatsApp/Telegram messages may go to the AI for Autopilot. Nothing is picked by default.
  SMS from people (not short codes) is already allowed by R44.
- **Fast path:** items from picked chats and SMS from people are sent to the AI after a 45-second quiet window
  following the last such arrival, at most once a minute, within the daily cap. Items the owner wrote themselves
  never create a reply suggestion.
- **Rules (code, not AI):**
  - Reply: only for chats with a real person or group, `importance` high or normal. It closes on Skip, on Deputy's
    result, on expiry, or when Inflow sees an own message in that conversation. The last one rarely fires, since
    a reply typed inside WhatsApp usually just clears the notification, so the anti-nagging rules must not
    depend on it.
  - Bill: `kind` bill or a to-do with a due date and an amount; one suggestion per biller and due date
    (de-duplicated across SMS, email and notification by biller, amount and due date).
  - Event: a to-do with a time in the future.
  - Money surprise (no AI): a debit at least 3× the median of the last 90 days in its category and at least
    PKR 5,000, or any debit over PKR 50,000, or money in from a name never seen before. The owner can change the
    thresholds in Settings.
- **Expiry:** a reply suggestion expires after 24 hours, an event at its time, a bill 3 days after its due date,
  a money surprise after 7 days. Expired ones leave the waiting list but stay in history.

### 8.3 Actions (what Run does)

| Kind | Run does | Uses Deputy? |
|---|---|---|
| Event | Opens the calendar's "new event" screen filled in (`CalendarContract` insert), and sets an alarm 30 minutes before if the owner turns that on (`AlarmClock.ACTION_SET_ALARM`) | No |
| Bill | Sets a reminder notification for the morning of the due date; "Open" on that reminder opens the biller or bank app | No (Deputy optional: "find this bill in the app", read-only) |
| Reply | Deputy task (code-built): "In <app>, open the chat with <name>, find the answer to their message from <allowed apps>, and type a reply." Their message goes in the untrusted block (§8.1). The gate shows the composed text before send | Yes |
| Money surprise | Opens the bank app; optional Deputy read-only task "show the last five transactions" | Optional |

Deputy's allowed apps for a reply are the chat's app plus apps the owner lists in Autopilot settings as places to
look (default: Contacts, Maps, Calendar, Gallery). Deputy's trust table still applies on top.

### 8.4 Surfaces

- **Inflow:** a "Waiting" block at the top of Home and a Suggestions list (waiting / history). A notification per
  new suggestion with Run and Skip, posted silently except reply suggestions, which make one heads-up. Settings:
  on/off per kind, money-surprise thresholds, digest times (default 08:00 and 20:00), places Deputy may look.
- **Halo:**
  - **Edge pulse:** while anything is waiting, a slow pulse in the Autopilot colour every few minutes (reuses the
    stage 3 reminder flash), off in quiet hours.
  - **AOD:** a "Waiting" row with the count and the titles of up to three suggestions. **Titles only**, never
    message text ("Reply to Ali", "Bill due 25 Nov"). Tapping it requires unlocking first.
  - **Titles are built by code, not the AI (builder check):** kind + name + date ("Reply to Ali",
    "Bill due 25 Nov", "Meeting 11:00 tomorrow", "Large debit at Alfalah"). A model-written title could leak
    content onto the lock screen ("Reply about the biopsy result"). The AI's `suggest` field therefore carries
    `type`, `due` and `detail`; `detail` is shown only inside Inflow and Deputy.
  - **Bubble:** a small draggable, touchable overlay (separate from the non-touchable edge window) showing the
    waiting count; tapping opens a small list over the current app with Run and Skip. Shown only when something
    is waiting; can be switched off.
  - **Creature** (§8.5) on a new AOD face and on Halo's Home.
- **Daily digest:** posted by Inflow at the digest times when anything is waiting; a tap opens Suggestions.

### 8.5 Creature and wallpaper

- **State lives in Inflow** (it knows chores and money); Halo only draws it. Pure Kotlin in Inflow's core:
  - Food: +1 per suggestion done, +1 per no-spend day (no money out except own transfers), −1 per suggestion that
    expired unanswered. Level grows with total food; it never dies, it only gets hungry.
  - Mood from the last 3 days: happy, content, hungry, sleepy (at night). Each mood has a colour.
  - Exposed as `creature` JSON: `{ "level", "mood", "colour", "food_today", "streak_no_spend" }`.
- **Halo draws it** with its own canvas renderer: an original simple creature (no characters from existing games
  or apps), a few poses per mood, animated only while the AOD is on.
- **Wallpaper:** when the owner turns it on, Halo renders a wallpaper from the mood colour (gradient plus the
  creature's silhouette, its own design) and sets it with `WallpaperManager.setBitmap` (`SET_WALLPAPER`, a normal
  permission), at most once a day or when the mood changes. Stage 1 checks on the phone that HyperOS re-themes
  from it; if it doesn't, the wallpaper still changes and theming is dropped (no workaround without the owner).

### 8.6 Cards (Design Editor)

- From Inflow's report screen and from Halo's creature screen, "Make a card" opens
  `designeditor://card?...` with numbers only: week or month, money in and out per account, top category, top
  merchant, no-spend days, chores done, creature level and mood colour.
- Design Editor adds two card templates (week, month) and fills them; the owner edits, exports or shares using what
  the editor already does.

## 9. Privacy decisions (my calls; the owner can overrule)

- Full text crosses only from Inflow's provider to Deputy, only for the suggestion being run, and only when the
  owner tapped Run.
- Inflow's fingerprint lock does not guard Autopilot (owner's choice): Run and Skip work from the notification
  and the bubble on an unlocked phone. Inflow's own screens, including Suggestions and the source message, stay
  behind the fingerprint.
- Never through the channel: items from apps blocked from AI, OTPs, Strongroom and Inflow items. Same list as
  Inflow's AI rules, so one rule covers both.
- Halo receives titles and counts only, because it draws on the lock screen.
- Design Editor receives numbers and short labels only.

## 10. Stages (each ends with Store builds the owner installs)

1. **Channel and autopilot core:** the permission in all four apps, Inflow's provider, the fast path, suggestion
   rules and the AI field, Inflow's Waiting block, Suggestions list and notification cards, Deputy's
   `RunSuggestionActivity`, system actions for events and bills. Wallpaper theming check on the phone (one probe).
2. **Visual layer:** Halo edge pulse, AOD Waiting row, bubble, daily digest.
3. **Fun layer:** creature state in Inflow, creature face and Home in Halo, wallpaper, Design Editor cards.

## 11. Testing

- JVM: suggestion rules (each kind, de-duplication, expiry, own reply closes it), fast-path timing, money-surprise
  thresholds, AI `suggest` parsing (malformed dropped), provider refusing blocked/OTP/Strongroom items, Deputy task
  building from a suggestion, creature food and mood maths, contract fixtures parsed by all four apps.
- A JVM or instrumented check that the provider and Deputy's activity reject a caller without the permission.
- TS: contract package fixtures, Inflow and Halo screen helpers.
- Gates: `pnpm test`, `pnpm typecheck`, each app's Gradle unit tests and `assembleDebug`, `invariant-reviewer`.
- Phone: per stage, installed from the Store; checks listed in the plan (a real bill SMS, a real chat request, an
  event in Roman Urdu, a large debit).

## 12. Left to the builder

- Provider schema details, URIs and how state updates are validated.
- Exact prompt wording for the `suggest` field and the fast-path window tuning.
- Creature art, poses and colours; the AOD face layout; the bubble's look and drag behaviour.
- Card template designs.
- Whether Halo's bubble reuses Clipboard's bubble code (copied, not shared).
- How Deputy's "Starting" screen looks, within `@apps-hub/ui`.

## 13. Later ideas (not in this build)

HomeNet "new device on your Wi-Fi" and TunnelWall "an app contacted a tracker" on the edge; Android 16 progress
notifications (deliveries, rides) drawn around the edge by Halo; Clipboard suggesting actions for copied addresses;
"what did I do last Saturday" day pages.
