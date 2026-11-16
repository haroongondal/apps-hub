# Inflow: design

Status: the owner asked to start implementing on 2026-11-13. The one open question
was settled the same day (see "Settled question" at the end).
"Inflow" (`com.haroon.inflow`, Store release id `inflow`, brand `inflow`) is the
owner's pick (2026-11-13), renamed from the working name "Notebox" before stage 1
shipped, because the owner plans a separate note-taking app.

## Why

The owner gets bank SMS, bank emails, WhatsApp messages and app alerts all day,
and none of it is organised or searchable after it leaves the notification shade.
Banking apps can't be analysed by AI, but their SMS and emails can. Inflow keeps
a private, permanent, organised copy of every notification on the phone and
uses an AI model to make sense of it: spending per account and category, a
one-line summary of every item, what's important, and what's coming up.

It is for one person, on one Android phone (Xiaomi HyperOS), installed from the
private Store. Nothing is shared or synced.

## Goals

1. Capture every notification from every app the owner hasn't switched off: app,
   sender or contact name (email and messaging apps), group or conversation name,
   title, full text, time.
2. Import the SMS inbox, including SMS received before install, and keep up with
   new SMS.
3. Download the full text of Gmail emails from senders the owner marked (banks,
   cards), using a Gmail app password.
4. Turn bank SMS and emails into a spending ledger, counted once even when the
   same transaction arrives by SMS, SMS notification, Gmail notification and email.
5. Send new notifications to an AI model in batches and store what it returns
   next to the untouched original.
6. Let the owner ask questions about the saved data (Ask AI tab).
7. Keep it organised: rename senders, per-app recording and keep-for periods,
   rules (tag, hide, important), search.

## Non-goals

- iOS (iOS gives no app access to other apps' notifications).
- Outlook or any mail provider other than Gmail.
- Notifications that arrived before install (Android can't provide them). SMS is
  the exception, through the inbox.
- Replying, dismissing, snoozing or otherwise touching notifications. Inflow
  only reads; the phone's shade behaves exactly as before.
- Saving photos, voice notes or attachments. Only the text the notification
  carries ("Photo", "Voice message") is kept.
- Copying the whole Gmail mailbox. Only marked senders are downloaded.
- An on-device model. AI runs through an API, as in Deputy.
- Sync, cloud backup, multiple devices.

## Anti-goals (would be a failure even if it works)

- Silently missing notifications: the owner trusts it as a complete record, so a
  dead listener or a killed background process must be visible on the home screen.
- Counting one transaction twice, or counting a transfer between the owner's own
  accounts as income or spending.
- Changing or losing the original text of anything captured.
- Sending to the AI anything the owner blocked, any OTP, or anything from an app
  with recording switched off.
- Data leaving the phone by any route other than the owner's chosen AI provider
  (no analytics, no crash reporting, no Android cloud backup).
- Noticeably draining the battery.

## Constraints

- Lives in this monorepo as `apps/inflow`. Android only. React Native + Expo SDK
  54 like the other apps; Kotlin owns capture, storage, parsing, Gmail and AI
  (like Deputy and Strongroom), and RN only renders. Shared UI from
  `@apps-hub/ui` with a new `inflow` brand (add to `BrandKey` in
  `packages/ui/src/tokens.ts`, regenerate CSS). Copy: sentence case, plain words.
- Installed and updated only through the private Store; never adb-installed on
  the owner's phone. Each stage ships as a Store release.
- The phone is shared with other Claude sessions: follow the coord rules in
  CLAUDE.md for device claims.
- HyperOS kills background apps unless Autostart is on, and blocks some special
  access for sideloaded apps ("restricted settings"). Setup must check both and
  lead the owner through them.
- No proprietary SDKs, no telemetry. Audit licences of every new dependency.

## What the owner decided

### Capture
- Every app is recorded by default, including apps installed later. The owner can
  switch recording off per app; when they do, Inflow offers to delete what's
  already saved from it. Strongroom and Inflow itself start switched off.
- For messaging apps, items are grouped into one conversation per contact or group.
  If a sender deletes a message, the saved copy stays, marked "deleted by sender"
  (my guess, confirmed by silence; easy to drop).
- OTP codes are removed a few minutes after arrival (my call: 5 minutes) and are
  never sent to the AI.

### SMS
- Inflow reads the SMS inbox directly (READ_SMS / RECEIVE_SMS): a full import on
  first run, then new SMS as they arrive. An SMS and the messaging app's
  notification for it are merged into one item automatically, with no prompt.

### Gmail
- Gmail only. Sign-in with a Gmail app password (needs 2-Step Verification on
  the owner's Google account); the password is stored encrypted with an Android
  Keystore key, as Deputy stores API keys. Google sign-in was ruled out: an
  unreviewed private app gets signed out every 7 days.
- The Gmail app's notification gives sender, subject and opening lines at once.
  For senders the owner marked, Inflow downloads the full email (checks every few
  minutes and when a Gmail notification arrives). Nothing else is downloaded.

### Renaming senders
- Any sender (a 4–6 digit SMS short code, an email address, a contact) can be given
  a name inside Inflow only; phone contacts are untouched. Several senders can
  share one name and then show as one sender. Names apply to old and new items.
- The same screen marks a sender as a bank or card, which turns on bank parsing
  and full Gmail download for it.

### Money
- Bank messages are read with fixed patterns per bank format, fully on the phone,
  so money works with no API key. Formats to support from day one (owner's real
  samples, numbers changed):

  ```
  Dear Customer,
  PKR 593,249.01 Credited to your A/C: 0847-1***2310 on 13-Nov-26 at 12:02:54
  Bal: Reply with AB
  021111225111
  ```
  (Bank Alfalah: money in, no counterparty, no balance)

  ```
  Dear Customer,
  Your Debit Card against A/C: 0847-1***2310 is charged for PKR 1,500.00 on 12-Nov-26 at 16:23:38 at SHAAFI INTERNATIONAL HOSPIslamabad PK.
  ```
  (Bank Alfalah debit card: money out; merchant and city are run together)

  ```
  PKR 50,000 received from HAROON MUKHTAR* in your UBL A/C *1733 on 01-OCT-2026 21:03 via your Raast ID. Tx ID 7224343340. For info 111825888.
  ```
  (UBL Raast: money in, counterparty, transaction id)

  Non-money SMS, such as Jazz's Roman Urdu data warning ("Mahana 5GB 12 ghantay
  main khatam ho jaye gi…"), stay ordinary items.
- One transaction is counted once even if it arrives by SMS, notification, email
  notification and full email.
- A transfer from the owner's own name is marked "own transfer" and left out of
  income and spending; the owner can change any transaction's marking.
- Money tab: transactions per account (Alfalah 2310, UBL 1733, …), money in and out
  per month, totals by merchant and by category.

### Rules
- Per app: record on/off; keep for forever / 1 year / 90 days / 30 days (defaults:
  bank SMS, Gmail and messaging apps forever, everything else 90 days); block from AI.
- Per contact or sender: block from AI.
- Rules matching app, sender, and/or words in the text, with actions: add tag,
  hide from the main list (still saved and searchable), mark important.
  Example: "Bank Alfalah" + "Debit Card" → tag "Card spend"; text contains "OTP" →
  hide.
- The owner's rules always override the AI's importance.

### AI
- Same setup as Deputy: an OpenAI-compatible model address (Gemini, Groq, …),
  the owner's API keys stored with the Keystore, a Test button per key, and
  Deputy's warning that free-tier Gemini keys let Google use what is sent (here,
  that means private messages and bank SMS).
- New notifications wait in a queue. Every 30 minutes, if the queue isn't empty,
  all of them go in one request (split into as few requests as needed if too big).
  No request when nothing is new. A "Send now" button sends the queue at once
  (my call).
- Never sent: items from apps or senders blocked from AI, OTPs, apps with
  recording off.
- The original text is never changed; the AI's result is stored next to it.
- Per item, the AI returns:
  - kind: money, message, delivery, bill, reminder, promotion, account alert, other
  - a one-line plain-English summary, even for Urdu or Roman Urdu text
  - importance: high, normal, low
  - money details for transactions: in / out / own transfer, amount, currency,
    account, merchant or person (cleaned: "Shaafi International Hospital,
    Islamabad"), spending category. Where a bank pattern already read the amount,
    the pattern's numbers stand and the AI only adds category and clean merchant
    name. Transactions only the AI found are marked "read by AI".
  - to-dos and dates ("Kal meeting 11 baje hai" → "Meeting tomorrow at 11:00")
  - suggested tags, which only take effect when the owner accepts them or a rule
    applies them
- Ask AI tab: the owner types a question ("How much did I spend on health in
  October?", "What did the family group decide this week?"). Inflow sends only
  the time range and apps the question needs, never blocked items, and shows the
  answer.

### Privacy and lock
- The saved history is encrypted on the phone.
- Opening Inflow needs fingerprint or the phone PIN.
- Android cloud backup is off for the app.

### Screens
- Bottom tabs: Home, Money, Ask AI, Settings. Search everywhere.
- Home opens on a summary (owner picked "summary first"): this month's money in
  and out per account, Important, Coming up (AI to-dos and dates), Messages
  (conversations with new-item counts), Apps (per-app counts). Each block opens
  the full list. A capture-health warning appears at the top when needed.
- Tapping a sender, contact, group or app opens its items as a thread, newest
  first, each showing original text, AI summary and tags.

## Stages (the owner asked for stages, each installed and tested before the next)

1. **Capture and browse.** Notification listener, encrypted store, fingerprint
   lock, per-app recording and keep-for, OTP removal, sender renaming, summary
   home (money block empty until stage 2), threads, search, setup checks
   (notification access, restricted settings, Autostart, battery) and the
   capture-health warning.
2. **SMS and money.** First, check that the app as installed by the private Store
   can be granted READ_SMS and RECEIVE_SMS: Android only allows these "hard
   restricted" permissions when the installer allows them. If it can't, changing
   the Store app's installer is part of this stage. Then: inbox import and live SMS, merging SMS with its
   notification, bank patterns for the three formats above, own-transfer
   marking, Money tab, transaction de-duplication.
3. **Gmail.** App-password sign-in, marked-sender download, merging email with
   its notification and with SMS transactions.
4. **AI.** Keys and model settings, the 30-minute batch and Send now, block
   lists, stored AI results, AI money details and categories, Coming up block,
   Ask AI tab.
5. **Rules.** Tags, hide, important, sender and word matching, and applying a
   new rule to items already saved.

## Calls I made (the owner can overrule any)

- Name "Inflow".
- OTP removal after 5 minutes; OTP detection by pattern (a code of 4–8 digits
  near words like OTP, code, PIN, password, or Urdu/Roman Urdu equivalents).
  The whole OTP item is deleted (the code is never kept, masked or otherwise), so
  the "never change the original" rule holds for everything that is kept. A
  record of the deleted item (a hash, no text) stops a later SMS inbox sync from
  bringing it back. An OTP message is never a transaction, even if it names an
  amount ("OTP 123456 for PKR 25,000 at Daraz"): the bank sends the real charge
  separately. A message that matches a bank transaction pattern is never treated as
  an OTP, so a misfire can't delete a ledger source.
- Own transfer: recognised by the owner's name, which the owner enters in
  Settings (matches "HAROON MUKHTAR" in the UBL sample), **and** by pairing: money
  out of one of the owner's accounts and the same amount into another of the
  owner's accounts within 30 minutes are linked as one own transfer, even when
  neither side names anyone (the Alfalah credit sample names no one). The owner
  can unlink a pair.
- Duplicate transactions merge only across channels (SMS, SMS-app notification,
  Gmail notification, full email): same amount, same account ending, within 10
  minutes, from different channels. Two items from the same channel are never
  merged, so two real PKR 1,500 charges stay two. A matching transaction ID (UBL's
  "Tx ID") merges regardless of time, and different IDs never merge. Each source
  stores its channel and transaction ID; the earliest source's time is kept and
  every source is linked.
- Money totals are per account, never converted between currencies.
- Transactions are kept even if the item they came from is later removed by a
  keep-for period.
- Sender names from phone contacts (READ_CONTACTS) fill in where the
  notification gives only a number; a name set in Inflow overrides them.

## Left to the builder

- Storage engine and how encryption is done (e.g. SQLCipher vs encrypted fields),
  as long as the history is unreadable from a copied file or backup, and capture
  keeps working while Inflow is locked. The fingerprint lock is a lock on the
  screens; the encryption key must be usable by the background listener without
  the owner present. Say this plainly in the setup screen.
- How notification fields map to sender, conversation and text per app
  (MessagingStyle, EXTRA_BIG_TEXT, group summaries, updates to the same
  notification id) and how repeated updates of one notification are de-duplicated.
- Full-text search approach, including Urdu and Roman Urdu; `packages/library-core`
  already normalises Arabic and Urdu for the PDF library and may be worth reusing.
- IMAP library choice for Gmail (licence-audited).
- Whether Deputy's OpenAI-compatible provider, key vault and model list are copied
  or extracted into a shared module.
- The AI request and response format, prompt, and how Ask AI chooses which data
  to send, within the rules above.
- How the 30-minute schedule survives HyperOS (WorkManager or a foreground
  service), and how many items or tokens one request may carry.
- Exact keep-for cleanup timing, retries when the AI or Gmail is unreachable.
- Launcher icon and brand colours.
- Test strategy: Kotlin JVM tests for pure logic (parsers, OTP detection,
  de-duplication, rule matching, batching) as in Deputy and Strongroom.

## Settled question (was open; affects stage 4)

Transactions found only by the AI (no bank pattern matched: wallet alerts,
card-app pushes, a misread "PKR 500 cashback" promotion) **count in the Money
totals straight away**, marked "read by AI"; the owner fixes a misread by hand.
The owner chose this on 2026-11-13 over the "to check" default.

## Stage 4 answers (owner, 2026-11-14)

- Items saved before the first API key is added are never sent to the AI ("only new items").
- AI spending stops for the day at **$0.50** by default (counted from the tokens each reply
  reports); the owner can change it in Settings.

## Stage 4b answers (owner, 2026-11-16)

- WhatsApp message text is kept forever and never deleted automatically.
- WhatsApp chats are grouped by who they are with; the owner's own replies sit in that thread.
- The non-goal "saving photos, voice notes or attachments" is reversed for WhatsApp: every media file a WhatsApp notification exposes is stored, encrypted, kept as long as its message, never sent to the AI.
- Ask AI answers money questions from the ledger, so it sends transactions of any age (amount, account, merchant, category) when the owner asks; the AI also receives each item's chat title and a you/not-you flag. Items saved before the first key are still never sent as items.

