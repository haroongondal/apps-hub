# PRD 08 — Hold & failure notifications

| | |
|---|---|
| **Phase** | Unattended |
| **Depends on** | PRD 01, per the table in [README.md](README.md) — the one authority on dependencies. Two named fields from its §5 write path, listed in §9. Value is amplified by PRD 07, but nothing here waits on it |
| **Blocks** | Nothing |
| **Size** | **M**, not S. [IMPLEMENTATION-ORDER.md](../IMPLEMENTATION-ORDER.md) still lists S; §4 says why that is wrong, and correcting it is part of landing this |
| **Status** | Draft |
| **Author** | hmukhtar@outsentia.com |

Shared personas and strategic context: [README.md](README.md). How a run ends —
scan hold, layer-3 hold, terminal statuses — is stated once in that file's *How a run
ends today* and is not restated here.

---

## 1. Executive Summary

We're building **hold and failure notifications** — native OS notifications when a
run needs a person or ends badly — for **the Operator** to solve the problem that a
run waiting for a human is invisible unless they happen to be looking at the app,
which will close the gap between "the automation needs you" and "you find out".

The feature is small in surface and not small in preconditions. The event that most
needs to notify — *step 4 needs you* — **cannot currently be told apart from the
Operator pressing Pause themselves**, so a discriminator on `AutomationHoldEvent` is
part of this PRD, not an implementation detail. §5 carries it.

---

## 2. Problem Statement

### Who has this problem?

The Operator, whenever a run pauses or fails while the app is not in front of them
— which, for a scheduled run, is the normal case.

### What is the problem?

Every signal a run produces stops at the window or at the automated tab.

- Holds are broadcast as `AutomationHoldEvent` (`shared/types.ts`) on
  `IpcChannels.automationHold`, wired in `main/index.ts` from `control.on('paused')`
  and `control.on('resumed')`, and rendered by `HoldBanner` in
  [components/TopBar.tsx](../../src/renderer/src/components/TopBar.tsx) off the
  `useExtension` hook. Nothing leaves the window.
- The automated page shows an amber in-page banner with a Resume button — `render`,
  built by `buildBanner` in
  [extension/page-core.js](../../extension/page-core.js) — visible only on the tab
  being automated, in a browser the user may not be looking at. The engine is
  shared, so both backends render the same banner.
- Failures surface as one line of text: `ThreadView` renders `run.error` and
  `run.failedStepIndex` for the selected run, fed by the `onProgress` listener in
  the `useRuns` hook.
- The extension quitting mid-run reaches main as `control.on('disconnected')`, which
  `main/index.ts` wires to `sendStatus` and nothing else — a status dot changes colour.

So the run parks itself and waits. The wait resolves only on resume or cancel —
`ExtensionBridge.waitWhileHeld` on the extension backend, the private
`waitWhileHeld` on `PlaywrightSession` — and there is no timeout and no escalation
on either.

### The defect that makes this PRD more than a wrapper

`AutomationHoldEvent` is `{ held, reason, automatic }`. Four things produce a hold and
**three of them set `automatic: false`**:

Each producer exists **once per backend**, and `main/index.ts` sees them through
one `SessionControl` interface, so the table below is four producers and eight
call sites.

| Producer | Extension backend | Playwright backend (default) | `automatic` | `reason` today |
|---|---|---|---|---|
| Scan hold | `runStep` → `{type:'SCAN'}` → `scanSensitive` | `scanHold()` → `holdWith(reason, true)` | `true` | a bare label: `CAPTCHA`, `password field`, `payment field`, `one-time code` |
| **Layer-3 hold** | `holdForHuman` (extension-session.ts) → `ExtensionBridge.pause` | `PlaywrightSession.holdForHuman` → its own `pause` | **`false`** | `step 4 needs you — the action ran but the page did not react to it at all` |
| Renderer Pause button | the `automationPause` handler (`main/ipc.ts`) → `control.pause` | same handler, same interface | **`false`** | `paused from the app` |
| In-page banner Pause | `PAUSE_REQUESTED` (background.js) | `onControl` with `type === 'pause'` | `false` | `paused by the user` |

`scanSensitive` itself lives in `page-core.js` and is shared; only the code that
calls it before a step is duplicated.

So filtering on `automatic` gives a choice between two wrong products: notify only on
`true` and the *step 4 needs you* case — the one the whole feature exists for — never
notifies; notify on `false` and the app interrupts the Operator to tell them they
pressed Pause. There is no third option in the current contract.

### Why is it painful?

- **User impact.** A run held at 06:05 on a CAPTCHA sits there until the Operator
  independently decides to check. 🔶 **Assumption** — no telemetry exists, so how long
  that takes is unmeasured; the design intent (*"you do that one step by hand and press
  Resume"*) assumes the user knows to.
- **Business impact.** With PRD 07, this is the difference between unattended
  automation and automation that quietly stops. A held run also occupies the queue head
  (PRD 05 §7), so 🔶 **Assumption:** one unnoticed hold blocks everything behind it —
  true of the design as PRD 05 specifies it, unobserved in practice because neither
  queue nor schedules exist yet.

### Evidence

- **Code.** No `Notification` usage anywhere in `src/`. Every hold and failure path
  terminates in the renderer or in the automated tab.
- **Code.** Both hold kinds park indefinitely when nobody is present. A scan hold
  spends its `MAX_HELD_RETRIES` budget only across resumes — the `dispatch` loop on
  each backend goes back into `waitWhileHeld`, and `resume` grants a one-step scan
  bypass (`skipScanOnce`, a field on `PlaywrightSession` and a persisted-state key
  in `background.js`) — so unattended it blocks exactly like a layer-3 hold.
- **Design.** Layer 3 is explicitly a handoff to a human
  ([HOW-IT-WORKS.md](../../HOW-IT-WORKS.md) §6). The handoff has no doorbell.
- 🔵 **Open Question:** how long does a hold currently go unnoticed? Unmeasurable
  today — no hold or resume edge is recorded anywhere. §6 says what has to be emitted
  before the question can be answered.

---

## 3. Target Users & Personas

**Primary: The Operator** — needs to be told, not to check.

**Job-to-be-done:** *When an automation needs me, I want to be told wherever I am,
so it is not still waiting an hour later.*

---

## 4. Strategic Context

**Ladders up to:** unattended completion. A run that stops and waits silently is
not unattended; it is abandoned.

**Why now.** Immediately after PRD 07, because that is when holds start happening
while nobody is watching. Before PRD 07 it is a nicety; after it, it is what makes
a held run recoverable.

**Why it is M and not S.** An earlier draft of this PRD called it "genuinely small —
Electron's `Notification` API, a few event hooks, and a preference". Four of its
requirements are none of those things:

1. **A discriminator on `AutomationHoldEvent`** (§2). A data-contract change to
   `shared/types.ts` with edits in six files, two of them backend twins.
2. **Clicking a notification while the app is closed.** Nothing in the tree registers
   a URL scheme: no `setAsDefaultProtocolClient`, no `open-url` handler, and the
   `second-instance` handler in `main/index.ts` takes no arguments and so ignores
   `argv` entirely. §5 enumerates what that costs.
3. **Somewhere to keep preferences.** The database has two `MIGRATIONS` entries and
   six `STRICT` tables as of 2026-08-27 — `system_routines` and `user_routines` from
   the first, PRD 01's `runs`, `run_events`, `run_artifacts` and `run_repairs` from
   the second — none of which is a settings store.
4. **A hold edge and a resume edge on the record**, without which the primary metric
   has no producer (§6).

Two of those (1 and 4) are contract changes to types listed in
[AI_CONTEXT.md](../../AI_CONTEXT.md) §6, so its §13 rule applies: update that file in
the same change, and delete its §12 drift item about a human hold being reported as
`healing`, because this PRD is what fixes it.

---

## 5. Solution Overview

### What main can observe today

Everything below already exists; the feature is a listener in main, not a new pipeline.

Main does not talk to a bridge. It holds a **`SessionControl`**
([session-control.ts](../../src/main/automation/session-control.ts)) — `connected`,
`isPaused`, `pause`, `resume`, `cancel`, `setRunContext`, `on` — which
`ExtensionBridge` and `PlaywrightSession` both implement, and `main/index.ts` picks
one at boot on `AUTOMATION_BACKEND`. Subscribing to `control.on(...)` therefore
reaches both backends for free; anything below that names only one does not.

| Signal | Where | Carries | Reaches |
|---|---|---|---|
| `control.on('paused', reason, automatic, at)` | `ExtensionBridge.receive`'s `paused` branch and `pause()`; `PlaywrightSession.holdWith`, reached from `pause()`, `scanHold` and `onControl` | reason, `automatic`, and the `RunContext` | broadcast as `automationHold` |
| `control.on('resumed')` | `receive`'s `resumed` branch and `resume()` on either backend | nothing at all | same channel, `held: false` |
| `control.on('disconnected')` | the socket `close` handler in `ExtensionBridge.adopt`. **Extension backend only** — `PlaywrightSession` never emits it | nothing | `sendStatus` only |
| `target-closed` | `ExtensionBridge.receive`. **Extension backend only**; the Playwright equivalent is a `page.on('close')` that retargets rather than aborting | **no event is emitted** — it fails pending requests and calls `abortRun` | the in-flight step rejects with `the automated tab was closed` |
| terminal progress event | `runRoutine`'s final `emit` and its catch | `status`, `error`, `stepIndex` | `automationProgress` |

An earlier draft said the terminal event carries `stepIndex: -1`. Verified
2026-08-27: it carries `stepIndex: activeStep`, which is the failing index once the
step loop has started and `-1` only for a failure before it. PRD 01 already persists
that as `RunSummary.failedStepIndex`, so the deep-link target exists.

`cancel()` and the socket-close path **never emit `resumed`**. They clear `paused` and
reject the waiters, silently. Anything in this PRD that arms a timer on a hold must
therefore disarm it on three more edges, not one — and `disconnected` and
`target-closed` fire on one backend only, so the Playwright equivalents have to be
found rather than assumed.

### The discriminator

Replace `automatic: boolean` on `AutomationHoldEvent` with:

```ts
kind: 'scan' | 'human' | 'user'
```

- `scan` — the extension refused to act (`scanSensitive`). Notifies.
- `human` — a layer-3 hold from `holdForHuman`. Notifies, and is the priority case.
- `user` — the Operator pressed Pause, in the app or in the page. Never notifies.

**Reason-string matching is not an acceptable substitute.** The reasons are composed
in four places (`runRoutine`'s `NeedsHumanError` catch, the `automationPause`
handler's default, `PAUSE_REQUESTED` in background.js, and `onControl` in
playwright-session.ts) and one of them is model-adjacent
prose. A regex over them is a silent-breakage machine.

Where the edits land, and no further:

| File | Change |
|---|---|
| `shared/types.ts` | `AutomationHoldEvent.kind` replaces `automatic` |
| `session-control.ts` | `SessionControl.pause` becomes `pause(reason, kind: 'human' \| 'user')`, so the compiler finds both implementations |
| `extension-bridge.ts` | that new `pause` signature; the `paused` emit carries `kind`; `receive` maps the extension's `auto === true` to `scan` and `auto === false` to `user` |
| **`playwright-session.ts`** | the same, on the default backend: `pause`, `holdWith`'s third argument, `scanHold` emitting `scan`, and `onControl` emitting `user` |
| `extension-session.ts` | `holdForHuman` passes `'human'`; `PlaywrightSession.holdForHuman` does the same |
| `main/ipc.ts` | the `automationPause` handler passes `'user'` |
| `main/index.ts` | the `control.on('paused')` broadcast forwards `kind` instead of `automatic` |
| `state/useExtension.ts` | `ExtensionState.holdAutomatic` becomes `holdKind` |
| `components/TopBar.tsx` | `HoldBanner`'s two branches become three |

Widening `SessionControl.pause` is what makes this a typecheck-enforced change
rather than a hunt: both backends implement that interface, so missing the
Playwright one is a compiler error instead of a silent half-migration.

No change inside the extension or the shared engine, and therefore **no
`EXTENSION_VERSION` or manifest bump** — `background.js` already distinguishes the
two cases with `auto`, and `PlaywrightSession` already passes an `automatic` flag
through `holdWith`. Both mappings happen in main. This is a §6
data-contract change; AI_CONTEXT.md §13 applies. PRD 01 §5 is already editing this same
type (adding `runId` and `stepIndex`), so land them together or pay for two passes.

### Events that notify

There is no urgency column, because Electron's `Notification.urgency` is **Linux-only**
and there is nothing to set on the two platforms this table names.

| Event | Source | Default | Suppressed when |
|---|---|---|---|
| Run held for a human (`kind: 'human'`) | `bridge.on('paused')` | on | the app is focused on that run; routine muted; grace period unexpired |
| Run held by a scan (`kind: 'scan'`) | `bridge.on('paused')` | on | same |
| Run failed (`status: 'error'`) | terminal progress event | on | routine muted; a hold notification for the same `runId` is live — it is closed and replaced |
| **Browser or extension lost mid-run** | `control.on('disconnected')` while a run is in flight | on | no run in flight |
| Run cancelled | terminal event classified as `cancelled` | **never** | always — see below |
| Run completed (`done` / `assisted`) | terminal progress event | **off** | — |

🔶 **Assumption:** a notification per successful scheduled run is how a notification
channel gets muted, and muting it costs the high-value ones. Unvalidated, and cheap to
revisit — it is one default.

**Cancel must not look like a failure.** `bridge.cancel()` raises `RunCancelledError`,
which `runRoutine`'s catch flattens into `status: 'error'`, so a naive listener
notifies the Operator that the run they just cancelled has failed. PRD 01 §5 classifies
cancellation **by error identity** in main; this PRD consumes that classification and
suppresses. It must not re-derive it from message text.

**Losing the browser is the likeliest unattended stopper** — 🔶 **Assumption**, based
on the failure mode being a browser quit rather than a page change, and unobserved. It
was simply missing from this table.

**But it has a producer on only one backend.** Verified 2026-08-27: `ExtensionBridge`
emits `connected` and `disconnected` from its socket handlers, while
`PlaywrightSession` emits nothing but `paused` and `resumed` — its `connected` getter
is hard-coded `true`, because that backend launches or adopts Chrome per run. So on
the default backend this row has no event to listen to, and a user quitting the
automation browser mid-run produces no notification. **Requirement:**
`PlaywrightSession` emits `disconnected` when the browser it was driving goes away,
so the `SessionControl` contract means the same thing on both backends. Without it
this row ships as extension-only and looks, from the app, like a feature that works.

Two rows that were here are **not this PRD's**: a scheduled run auto-disabled after
repeated failures, and a run ending `held-and-abandoned`. Both are PRD 07 events —
07 §5 and its `held-and-abandoned` scenario already say "and a notification is raised"
— and neither is producible at this PRD's dependency level. They arrive when 07 ships
and register through the channel built here. Bounding an unanswered hold is also 07's,
per README's *How a run ends today*; escalating a reminder is not the same thing as
ending the run, and this PRD does only the former.

### Content

The reason, not the category — but the reason has to be *made* readable first.

`scanSensitive` in `page-core.js` returns a **bare label**: `'CAPTCHA'`,
`'password field'`, `'payment field'`, `'one-time code'` — plus, because `SENSITIVE`
ends with `...WALL`, the bot-wall descriptions too (`'Cloudflare check'`,
`'DataDome bot check'` and six more). That label is what `background.js` sends as
`reason`, and what `scanHold` returns on the other backend, and what arrives on
`AutomationHoldEvent`. Only the layer-3 reason is already
a sentence, composed in `runRoutine`'s catch as
`step N needs you — <problem>` (for a no-op verdict, `problem` is `NO_REACTION`:
*the action ran but the page did not react to it at all*).

**Requirement:** main expands the four scan labels into sentences with an action —
*"A CAPTCHA is on the page. Solve it in Chrome, then press Resume."* — in the pure
module below, keyed on the label. An unrecognised label falls through to the raw string
rather than dropping the notification, because `SENSITIVE` in content.js can grow
without this map growing with it.

The old argument for carrying the reason was wrong and is worth correcting, because it
was an argument against a straw man: a notification reading *"Automation paused"* would
not be "strictly worse than the in-page banner" — that string **is** the banner's
fallback (`render` in content.js), and with a scan reason the banner reads
`Paused — CAPTCHA`. The banner is not the weak link. **Location is.** The banner is
rendered into the automated tab, in a browser window the Operator is by definition not
looking at when a scheduled run holds at 06:05. The notification's job is to reach them
outside that tab; carrying the reason is what makes it actionable once it has.

Never in a notification body: page text, extracted values, or anything from
`RunResult.extracted`. Hold reasons may name a selector — `could not read #total` —
which is acceptable; page content is not.

### The decision must be a pure module

`npm test` is vitest over `tests/**/*.test.ts` with **no Electron and no browser**
(AI_CONTEXT.md §2). If the notify/suppress/escalate logic lives inside a
`new Notification(...)` call site, none of §7's acceptance criteria can be asserted.

**Requirement:** split it.

- `src/main/notifications/decide.ts` — pure. `decideNotification(state, event, prefs, now)`
  returns a plan (`{ title, body, openRunId, openStepIndex }`), `null` for suppressed,
  and the next timer deadline. Also holds `expandHoldReason(label)`. No Electron import,
  so `tests/notifications.test.ts` runs under vitest like `tests/orchestrator.test.ts`.
- `src/main/notifications/service.ts` — impure and thin. Owns `new Notification`, the
  `click` handler, `close()`, `setTimeout`, and the `bridge.on(...)` subscriptions added
  beside the existing wiring in `main/index.ts`.

The clock is a parameter, not `Date.now()` inside the module, or the escalation and
rate-limit tests need fake timers to test arithmetic.

### Hold lifecycle and escalation

1. Hold arrives. Start a 🔶 **Assumption:** 10 s grace timer — a hold the Operator is
   already resolving should not interrupt them. Unvalidated.
2. Grace expires, still held → raise one notification.
3. 🔶 **Assumption:** 10 minutes later, still held → raise exactly one reminder, then
   stop. Arbitrary; configurable.
4. **Clear both timers and close any live notification on every exit edge:**
   `resumed`, `disconnected`, `target-closed`, and `cancel()` — the last three of which
   emit no `resumed`, which is why they must be subscribed explicitly. Also on
   `app.on('before-quit')`, beside `bridge.close()`.

Without step 4 the reminder fires for a hold that no longer exists — the Operator gets
"still waiting on you" about a run that was cancelled ten minutes ago.

### Suppression and rate limiting

- **Focused-on-it.** No notification if a window is focused (`BrowserWindow.isFocused`)
  and showing that run. The in-app signal is enough. 🔶 **Assumption:** focus is a good
  proxy for attention.
- **Per-routine mute.** Per-event-type toggles are not enough: 🔶 **Assumption** — a
  routine that fails every morning at 06:00 notifies every morning, and the only lever
  today is disabling failure notifications for everything, which costs the routines that
  matter. Mute is keyed on the **pair** `{routine_kind, routine_id}`, because a run is
  addressed as `{kind, id}` by `IpcChannels.automationRun` and the two id spaces are
  independent. System-routine ids come from the JSON in [updates/](../../updates/)
  (`sys.search-and-capture`), so a mute survives `syncFromDir` deleting and re-inserting
  every row.
- **Per-run cap.** At most **one live** notification per `runId`: a terminal failure
  closes the outstanding hold notification before raising its own. At most two raised
  per run, plus one escalation.
- **Global rate limit.** 🔶 **Assumption:** at most 6 in a rolling hour; beyond that,
  collapse into one summary and keep counting. The existing burst rule covered only
  failures arriving more than three a minute — a queue drain (PRD 05) — and not the
  ordinary hold-then-failure pair from a single run. In-memory is acceptable: a process
  restart resetting the window is not a harm.

### Preferences and persistence

Preferences have nowhere to live today: `MIGRATIONS` in
[database.ts](../../src/main/db/database.ts) has one entry creating `system_routines`
and `user_routines`, both `STRICT`. Per AI_CONTEXT.md §10, **append a new entry; never
edit a shipped one** — `PRAGMA user_version` is the cursor.

| Table | Holds |
|---|---|
| `notification_prefs` | one row (`id INTEGER PRIMARY KEY CHECK (id = 1)`): per-type toggles, quiet-hours window, grace and escalation intervals, and two counters — `raised`, `clicked` — which §6 reads |
| `notification_mutes` | `routine_kind`, `routine_id`, `muted_at`; primary key on the pair |

`NotificationPrefsStore.save(input: unknown)` is the validation boundary, matching
`UserRoutineStore.save` — the payload arrives straight off IPC. Take the database as a
constructor parameter and never touch Electron's `app`, so the store stays loadable
under plain Node; its assertions go in `tests/db.verify.ts` behind `npm run test:db`,
not vitest, because better-sqlite3 is built against Electron's ABI.

🔵 **Open Question:** do quiet hours suppress the notification or defer the run?
Deferring is arguably more correct — a run held at 3 a.m. is a run that should not have
started — but that is PRD 07's scheduling policy, not this PRD's.

### Channels

Per the §10 IPC recipe, each channel touches four places.

| Channel | Kind | The four places |
|---|---|---|
| `notifications:prefs:get` | invoke | `IpcChannels` in `shared/ipc.ts` → `handle` in `registerIpcHandlers` behind `trustSender` → a `notifications` namespace on `api` in `preload/index.ts` → the preferences pane |
| `notifications:prefs:set` | invoke | same four; shape-check in the handler, deep validation in the store |
| `notifications:open` | **push** | `shared/ipc.ts` → `broadcast` from `service.ts` → `onNotificationOpen(listener): () => void` in the preload, returning an unsubscriber like the existing four (`onRoutinesChanged`, `onProgress`, `onStatusChanged`, `onHold` — two of which already drop the `…Changed` suffix) → the renderer's thread view |

`NotificationPrefs` is a new type in `shared/types.ts`. Only error *messages* cross
IPC, so the pane must not read custom error fields.

### Deep-linking, including when the app is closed

Running app: `win.show()`, `win.focus()`, `app.focus({ steal: true })` on macOS, then
push `notifications:open` with `{ runId, stepIndex }`.

Closed app is four separate pieces of work, and this is what took the PRD off S:

1. `app.setAsDefaultProtocolClient('outsentia')` at boot in `main/index.ts` — in dev on
   macOS it needs `process.execPath` and the argv form, or the scheme resolves to the
   Electron binary.
2. A `protocols:` entry in [electron-builder.yml](../../electron-builder.yml), which is
   what writes `CFBundleURLTypes` into the packaged Info.plist. It has none today.
3. `app.on('open-url')` for macOS.
4. Windows and Linux deliver the URL in `argv`: parse `process.argv` on first launch,
   and **extend the existing `second-instance` handler**, which currently takes no
   arguments and throws the URL away.

🔵 **Open Question:** is the closed-app click worth all four? The alternative is to
scope it to "the app is running or in the background", which is where a scheduled run's
Operator most often is (🔶 **Assumption**), and revisit with PRD 07 data.

### Platform reality

- `Notification.isSupported()` is the only capability check that exists. It says the
  desktop environment can show notifications. It says nothing about permission.
- **There is no API to read notification permission on macOS or Windows.** So
  preferences must not claim to know. The honest line is: *"Notifications are supported.
  Whether they appear is up to the OS — if you see none, check System Settings →
  Notifications for this app."* An earlier draft promised the app would state "the OS is
  blocking notifications"; it cannot.
- **`urgency` is Linux-only.** No high/normal distinction on macOS or Windows.
- Linux additionally needs a running notification daemon; `isSupported()` is the guard.
- 🔶 **Assumption:** on Windows the toast attributes to the AppUserModelID, which
  electron-builder derives from `appId` (`com.cd.browser.autonomousbrowsing`) with the
  installer creating the Start-menu shortcut Windows requires. Unverified on a packaged
  build.
- 🔶 **Assumption:** in `npm run dev` notifications attribute to "Electron" and may be
  suppressed by an unsigned build. Unverified; a packaging concern, not a design one.

---

## 6. Success Metrics

**One caveat covers all of them:** the product emits no telemetry
([README.md](README.md)), so every number below is local to a user's machine and read by
asking them to export their run history. None of these is an aggregate dashboard.

### Primary

**Time-to-acknowledge a hold** — the hold edge to the resume edge.

- **Mechanism, which this PRD must build.** No producer exists today. A layer-3 hold's
  only trace is a progress event with `status: 'healing'` — the same value as ordinary
  repair chatter, which is the drift AI_CONTEXT.md §12 records — a scan hold never
  reaches `onProgress` at all, and a resume emits nothing on that channel. So this PRD
  widens `AutomationProgressEvent['status']` with **`held`** and **`resumed`** and emits
  both from the hold wiring in main through the single `onProgress` closure that
  `registerIpcHandlers` owns, which PRD 01's `RunStore` already wraps. The metric is
  then the delta between consecutive `held` and `resumed` rows in `run_events` for a
  `run_id`, with no schema change beyond PRD 01's. That closure is local to
  `registerIpcHandlers` today while the hold subscriptions live in `main/index.ts`, so
  one of the two has to move: either `registerIpcHandlers` returns the closure, or the
  `bridge.on('paused' | 'resumed')` wiring moves inside it — it already receives
  `bridge` and `broadcast`. The renderer's `onProgress` listener needs a branch for the
  two new statuses, or a hold renders as an ordinary step line.
- **Why not `held_at`/`resumed_at` columns on PRD 01's `runs` table.** A run can hold
  more than once — `runRoutine`'s catch continues past the held step, and PRD 01 counts
  `human_steps` precisely because that number can exceed one. Two columns cannot hold a
  sequence. Rows can.
- The `resumed` edge has no run context of its own: `ExtensionBridge.resume` and
  `release` know nothing about runs. The service already holds the held `runId` for its
  escalation timer, and that in-memory pairing is what stamps the resume event.
- **Baseline:** 🔵 **Open Question.** It cannot be measured before this ships, because
  the edges do not exist. The nearest honest comparison is holds resolved by users who
  turn the notifications off — self-selected, so weak evidence.
- **Target:** median time-to-acknowledge falls, measured unconditionally. The old target
  said *"under 5 minutes when the user is at the machine"*, which has no producer:
  nothing in the tree carries a presence signal. `BrowserWindow.isFocused` is available
  and is a proxy for *attention to the app*, not presence; Electron's
  `powerMonitor.getSystemIdleTime()` would be a real one but is not used anywhere and is
  session-dependent on Linux. 🔵 **Open Question:** is presence segmentation worth a
  column on PRD 01's `run_events`? Until it is, the metric is unconditional.

### Secondary

- **Click-through rate** — `clicked / raised`, both counters in `notification_prefs`,
  bumped by `service.ts` on raise and in `notification.on('click')`. Low click-through
  on holds means the body is not actionable.
- **Mute and disable rate** — counted from `notifications:prefs:set` writes and
  `notification_mutes` rows. Any meaningful number is a design failure. This replaces
  **notification dismissal rate**, which **cannot be measured**: Electron's `close`
  event is not guaranteed to fire, and a dismissal from macOS Notification Center does
  not emit it. Click-through plus mute rate is the proxy.
- **Abandoned-hold rate** — holds never resolved. Needs PRD 07's `held-and-abandoned`
  terminal state to be exact. Until then the proxy is a `held` event row with no
  `resumed` row whose run ended `cancelled` or `interrupted` (PRD 01's statuses).

### Guardrails

- **No notification storms.** At most one live notification per run, at most two raised
  per run plus one escalation, and at most 6 per rolling hour globally.
- **No notification for a run the user is actively watching.** Focused window showing
  that run → the in-app signal is sufficient.
- **No notification for a run the user ended themselves.** Cancel and the `user` hold
  kind are both silent.

---

## 7. User Stories & Requirements

### Epic hypothesis

We believe that notifying on holds and failures will collapse the time a run spends
waiting for a human, because today the only signals are in-app and in-page. We will
know we are right when median time-to-acknowledge — newly measurable via the `held` and
`resumed` events §6 requires — falls, and mute rate stays near zero.

Every scenario below is asserted against `decideNotification` in `decide.ts`, which is
why nothing asserts on urgency or on OS delivery: neither is observable.

### Story 1 — Being told a run needs you

**As** the Operator, **I want** a notification when a run pauses for me, **so
that** I can deal with it immediately.

```gherkin
Scenario: A layer-3 hold notifies, and is not confused with a Pause press
  Given a run in progress and no window focused on it
  When the run holds with kind "human" and reason "step 4 needs you — the action ran but the page did not react to it at all"
  Then exactly one notification is raised carrying that reason
  And its open target is that run's thread at step 4

Scenario: A scan hold notifies with its label expanded into an instruction
  Given a run in progress and no window focused on it
  When the run holds with kind "scan" and reason "CAPTCHA"
  Then exactly one notification is raised whose body names the CAPTCHA and says to solve it in Chrome and press Resume

Scenario: The Operator's own Pause is silent
  Given a run in progress and no window focused on it
  When the run holds with kind "user"
  Then no notification is raised

Scenario: No notification while the user is watching
  Given a window is focused and showing the running run
  When the run is held
  Then no notification is raised
  And the in-app hold state is shown as it is today

Scenario: One reminder, then silence
  Given a hold notification has been raised for a run that is still held
  When the escalation interval elapses with no resume
  Then exactly one further notification is raised for that run
  And no further notification is raised for it however long it stays held

Scenario: A resolved hold stops reminding
  Given a hold notification has been raised for a run
  When the run is cancelled, or the extension disconnects, or the automated tab closes
  Then the escalation timer is cleared
  And the live notification is closed
  And no reminder is raised afterwards
```

### Story 2 — Being told a run failed

**As** the Operator, **I want** a notification when a run fails, **so that** I do
not discover it a day later.

```gherkin
Scenario: A failed run notifies with its error
  Given a scheduled run that fails at step 6
  When the run ends with status "error"
  Then a notification carries the routine name and the error message
  And its open target is that run's thread at step 6

Scenario: A failure replaces the hold notification from the same run
  Given a hold notification is live for run R
  When run R ends with status "error"
  Then the hold notification is closed
  And exactly one failure notification is raised

Scenario: Cancelling is not failing
  Given a held run that the Operator cancels
  When the run's terminal event is classified as cancelled by error identity
  Then no failure notification is raised
  And the live hold notification is closed

Scenario: The extension quitting mid-run notifies
  Given a run in progress
  When the extension disconnects
  Then a notification says the browser extension stopped and the run cannot continue

Scenario: Success is silent by default
  Given success notifications are at their default setting
  When a run ends with status "done"
  Then no notification is raised
```

### Story 3 — Controlling notifications

**As** the Operator, **I want** to choose what interrupts me, **so that** I keep
the channel worth paying attention to.

```gherkin
Scenario: Per-type preferences
  Given failure notifications are disabled and hold notifications are enabled
  When a run fails and a later run is held
  Then the failure raises nothing
  And the hold notifies

Scenario: The app does not claim to know the OS permission state
  Given the preferences pane is open
  When Notification.isSupported() returns true
  Then the pane states that notifications are supported and that whether they appear is the OS's decision
  And it names where to check: System Settings, notifications for this app

Scenario: An environment that cannot show notifications says so
  Given Notification.isSupported() returns false
  When the preferences pane is open
  Then the pane states that this desktop environment does not support notifications
  And the per-type toggles are disabled
```

### Story 4 — Silencing one noisy routine

**As** the Operator, **I want** to mute a single routine, **so that** one failing
schedule does not cost me every other notification.

```gherkin
Scenario: A mute is per routine, not per type
  Given the user routine "Morning invoices" is muted
  And the system routine "Price check" is not muted
  When "Morning invoices" fails and then "Price check" fails
  Then only the "Price check" failure notifies

Scenario: A mute survives a system-routine resync
  Given the system routine "sys.search-and-capture" is muted
  When updates/ is re-synced and every system_routines row is re-inserted
  Then that routine is still muted

Scenario: The global cap collapses a burst
  Given six notifications have been raised in the last hour
  When a seventh event qualifies
  Then one summary notification is raised instead
```

### Constraints and edge cases

- 🔶 **Assumption:** a ~10 s grace period before a hold notification avoids noise on
  holds the user is already resolving. Unvalidated.
- One run at a time (`busy` in the orchestrator), so there is no aggregation case for
  holds — only for failures, which the global cap covers.
- A notification raised as the app quits must be cleaned up in
  `app.on('before-quit')`, beside `bridge.close()`.
- Deep-link into a run pruned by PRD 01 retention: open the run list with an
  explanation, never an error dialog.
- `target-closed` emits no event today, so the service either subscribes to a new one
  or infers it from the terminal error. The former is one `this.emit` in `receive`; the
  latter is message matching, which §5 rejects on principle.

---

## 8. Out of Scope

- **Push to phone, email, Slack, webhooks.** Real demand for unattended use, and a much
  larger surface: an outbound integration, credentials, and a delivery guarantee.
  Native-only first; revisit once PRD 07 shows how often the user is away from the
  machine entirely.
- **Notification action buttons** ("Resume" directly from the notification). Attractive,
  but resuming without seeing the page is exactly the blind retry the architecture
  avoids elsewhere — and on macOS an action needs `actions` plus a signed bundle, while
  Windows toast buttons and Linux daemons differ again. Click opens the thread instead.
- **Sound and dock badges.** `sound` is macOS-only, `app.setBadgeCount` covers macOS
  and some Linux desktops, and Windows needs `win.setOverlayIcon` instead. Three
  implementations for one signal; not until the notification itself is proven.
- **Linux as a supported target.** `isSupported()` is honoured and `urgency` is set
  where it exists, but no Linux desktop is tested and `getSystemIdleTime` is
  session-dependent there. Nothing here should be read as a Linux commitment.
- **Notifying on extension disconnect while no run is in flight.** The status dot is
  the right weight for "Chrome is closed"; interrupting the OS for it is not. Only a
  disconnect that kills a live run notifies.
- **Bounding an unanswered hold.** PRD 07 ends the run; this PRD reminds the user once.
- **The two PRD 07 events** (auto-disabled schedule, `held-and-abandoned`) — produced
  there, delivered through the channel built here.
- **In-app notification centre / history.** The run history *is* the history.

---

## 9. Dependencies & Risks

### Dependencies

- **PRD 01**, for four things, three of which are already in its §5 write path:
  - **`runId` and `stepIndex` on `AutomationHoldEvent`.** Without them a hold cannot be
    attributed to a run, so nothing here — notification, deep link, escalation key,
    metric — can be built. This is the single hardest dependency in the PRD.
  - **The failing step index on the terminal error event**, which today is `stepIndex: -1`.
    The failure notification's deep link is to a step.
  - **Cancellation classified by error identity**, so cancel can be suppressed without
    matching message text.
  - **The thread view and addressable views**, plus `RunStore` and `run_events` for §6.
- **This PRD's own contract changes:** `kind` on `AutomationHoldEvent`, and `held` /
  `resumed` on `AutomationProgressEvent['status']`. PRD 01 does not cover either.
- Electron 43's `Notification` (see [package.json](../../package.json)); no third-party
  dependency.
- A new `MIGRATIONS` entry for the two preference tables.
- **PRD 07** for the two events it owns, and for bounding a hold nobody answers.

### Risks

| Risk | Mitigation |
|---|---|
| **The `kind` change lands half-way.** `showHold` in the renderer still reads `automatic`, so a partial migration leaves the in-app banner mislabelling layer-3 holds as user pauses. | One change, six files, listed in §5. `npm run typecheck` catches the renderer and preload; the AI_CONTEXT.md §6 update lands with it. |
| **The label map drifts from `SENSITIVE`.** A new entry in content.js gets a bare label in a notification. | Fall through to the raw label rather than dropping the notification; assert the four current labels in `tests/notifications.test.ts` so a rename fails a test rather than a user. |
| **Notification fatigue.** Too many and the channel is muted, costing the high-value ones. | Success off by default; one escalation only; per-type toggles; per-routine mute; one live notification per run; a global hourly cap. Track mute rate as a health metric. |
| **OS-level suppression** — Focus mode, Do Not Disturb, denied permission — makes the feature silently absent exactly when needed, and the app cannot detect it on macOS or Windows. | Never rely on a notification as the only signal: the in-app hold state and the in-page banner both stay. Preferences state the limit honestly rather than guessing. |
| **A notification reveals sensitive content.** | Bodies carry the step's problem and, for scans, a field *category* — never page text or extracted values. `scanSensitive` returns a category by construction. |
| **The escalation timer outlives its hold** and reminds about a cancelled run. | Disarm on `resumed`, `cancel`, `disconnected`, `target-closed`, and `before-quit`. Story 1's last scenario asserts it. |
| **Deep-link to a pruned run.** | Open the run list with an explanation rather than an error. |

---

## 10. Open Questions

- 🔵 What is the current median time-to-acknowledge? Unanswerable until the `held` and
  `resumed` events in §6 exist; there is no clean pre-feature baseline.
- 🔵 Is the closed-app notification click worth a URL scheme, an `open-url` handler, an
  `electron-builder.yml` `protocols:` entry, and argv routing through `second-instance`?
  Scoping it out keeps the PRD nearer S.
- 🔵 Should quiet hours suppress notifications or defer the runs themselves? Deferring
  is more correct and belongs to PRD 07.
- 🔵 Is presence worth measuring — `powerMonitor.getSystemIdleTime()` plus a column on
  PRD 01's `run_events` — or is an unconditional median enough?
- 🔵 Is a phone channel needed for genuinely unattended use? Depends on whether users
  are near the machine when scheduled runs fire — measurable after PRD 07.
- 🔵 Should `target-closed` become a real bridge event, given that main currently learns
  about a closed tab only through a rejected step?
- 🔶 **Assumption:** a 10-second grace period, a 10-minute escalation, and a cap of 6
  notifications an hour. All three arbitrary.
