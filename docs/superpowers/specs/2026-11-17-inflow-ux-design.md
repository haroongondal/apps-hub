# Inflow: UX rework and quieter SMS (owner list item 5)

Approved by the owner on 2026-11-17 ("I approve the design"), after a phone walkthrough of the test build (3e15ed3).
Owner's words: "UX of inflow bothers me now, also lot of non important sms bothers me". Main purpose of the app (owner): fetch any financial info about themselves easily.

## Problems found on the phone (all in scope)
1. Home shows only the 8 most recent apps (`SqlItemStore.home` `LIMIT 8`), so Messages (SMS) and its contact list can be unreachable.
2. Two apps with the same label show as two identical rows ("Calendar" twice).
3. People and shops groups case-sensitively ("EMAN IFTIKHAR BAF" and "Eman Iftikhar Baf" are two rows).
4. Home "Important" is mostly bank payments, each twice (SMS + Gmail copy of one payment), already shown in Money.
5. SMS senders show as short codes ("8287") instead of the bank.
6. A LinkedIn notification title ("1 new message") became a chat name.

## Design

### Home (top to bottom)
- Money card: this month's money out and money in as large numbers, then the top 3 categories as one small bar row; tap opens Money. Replaces the per-account rows.
- Inbox: one row per chat-like app that has items (every app where `ContactApps.byContact` is true: SMS, Gmail, Teams, WhatsApp, ...), each with "n today" and a chevron; tap opens its contact list. Never capped, so SMS is always reachable.
- Important: high-importance items of the last 7 days, excluding items that are a transaction source (they live in Money) and repeats of the same transaction (one row per txn at most).
- Coming up (unchanged).
- Recent chats: the 5 latest conversations (today's block), with See all.
- All apps: one row opening a full app list (every app, newest first); apps with the same label are merged into one row (opening all their packages' items).

### Money
- A `Segmented` control at the top: Overview | Reports | All.
- Overview: month switcher; one totals card (Out, In, Net, count); "Where it went" category bars (amount, share); People and shops top 10 with See all; Accounts as one group (one row per account with in/out).
- Reports: the existing Reports group, Make a report now, notification row.
- All: the month's transaction list (today's list).
- Party grouping ignores case (group by `lower(COALESCE(label, counterparty, ''))`, show the most recent spelling); `partyTotals`/`listPartyTxns` match the same way.

### Quieter SMS
- In an SMS app's contact list, promotional senders fold into one "Promotions" row at the bottom (tap: their contact list). Nothing is deleted.
- A sender is promotional when most of its AI-read items are kind `promotion` (more than half of those with an `ai_results` row, at least 1) and none of its items is a transaction source. Banks therefore always stay visible.
- Owner override per sender: the item sheet of an SMS gets "Move to Promotions" / "Keep in my list"; the owner's choice wins (stored per sender key, new table or column; schema v7).
- Promotional senders are left out of Home (Important, Recent chats, Inbox counts).
- A short-code SMS sender whose items made transactions is shown with its account's bank name (for example 8287 -> "Alfalah"), unless the owner renamed it.
- A conversation whose name is a generic notification title ("1 new message", "n new messages") is not used as a chat name: fall back to the sender (parser fix + display fallback; no data rewrite of old rows needed beyond the display).

## Constraints
- `@apps-hub/ui` components and tokens only (Segmented, Group, Row, Readout if it fits); sentence case copy; no new dependency; no new permission.
- Kotlin owns the queries (promotional sender rule, merged apps, Important filter, case-insensitive parties, schema v7 for the override); RN renders.
- Tests: Kotlin JVM tests for the promotional rule and the generic-title fallback; SQL proven in sqlite3 (R32); node tests for any TS helper.

## Not in scope
- Deleting or stop-saving promotional SMS; budgets; a new visual theme.

## Left to the builder
- Exact layout spacing, the bar row styling within tokens, the Important dedupe key (txn id via `txn_sources`).
