# Inflow: spending categories and weekly/monthly reports (owner list items 3 and 4)

Owner request, 2026-11-17: "use AI to add some category on transaction ... feed that category to AI while generating summary so that I can know where did i spent this month"; "auto generate my spending summaries on each sundays and send me notification ... summary should not be markdown text. instruct AI to give data to you in JSON form and then generate tables and charts based on JSON. create robust stats. store summaries upto 8 weeks ... monthly summaries ... upto 4 ... my total stats should contain all info like my transfers to own bank accounts. I want as much stats as you can. Main purpose of the app is to make myself able to fetch any financial info regarding me in easy way."

## Why
The owner wants any fact about their money to be one tap away. Reports are the main deliverable; categories feed them.

## Goals
- Every transaction has a category (new and old), which the owner can change.
- A weekly report every Sunday and a monthly report on the 1st, made by the AI as JSON in a fixed shape, shown as tables and charts, with a notification.
- Keep the last 8 weekly and the last 4 monthly reports.
- Reports include transfers between the owner's own accounts.

## Non-goals
- Budgets, alerts on overspending, exports, currency conversion.
- Reports over messages (WhatsApp, email text): money only.
- A chart library: charts are plain views.

## Anti-goals
- A report that silently shows nothing or half a period: a failed report says so and retries.
- The AI overwriting a category the owner set.
- Any message text (SMS body, notification text) in a report or categorization request.

## Approaches (owner picked A)
- **A. The AI computes the numbers (picked by the owner).** The app sends the period's transactions; the AI returns totals, breakdowns and insights as JSON; the app validates the shape and draws it. Simple; the owner accepted that model arithmetic can be off.
- B. The app computes every number, the AI only categorises and writes insights. Rejected by the owner.

## Design

### Categories (item 3)
- List, money out: Food & dining, Groceries, Shopping, Mobile & internet, Bills & utilities, Rent, Transport, Fuel, Health, Education, Entertainment, Travel, Family, Charity, Sent to people, Fees & charges, Cash withdrawal, Other. Money in: Salary, Received from people, Refund, Other income. (Owner saw and accepted this list.)
- This list replaces `AiBatch.CATEGORIES`; the item AI prompt uses it, with the direction deciding which half applies. Existing values migrate: Food → Food & dining, Bills → Bills & utilities, Fees → Fees & charges; the rest keep their names; a money-in transaction holding a money-out category is cleared so it is categorised again.
- Uncategorised transactions (category NULL, not set by the owner) are sent in batches with transaction fields only: id, direction, amount, currency, account, counterparty or clean name, date, own flag. The reply maps id to category (and an optional clean name); unknown ids or categories are dropped. Runs in the existing 30-minute AI tick, respects the daily cost cap.
- The transaction sheet gets a category picker; an owner-set category is marked (new column) and never overwritten by any AI path.

### Reports (item 4)
- Kinds: weekly and monthly, local time. A weekly period runs from Sunday 21:00 to the next Sunday 21:00, so every transaction is in exactly one week; it is labelled with its Monday-to-Sunday dates ("Week of 10–16 Nov"). A monthly period is the calendar month. (My call, after the builder check.)
- Schedule: due when the period has ended and no report exists for it; the weekly one at Sunday 21:00, the monthly one on the 1st at 00:00 for the month before. Checked in the existing AI tick (listener process, every 30 min) and when Home opens. A missed time is made at the next check; only the most recent period of each kind is made (no backlog of old weeks).
- A "Make a report now" button in Money makes a report for the week so far (kind weekly, marked "so far", replaced by the real one when due).
- Request: the period's transactions (same fields as categorisation plus category), one compact line each, the owner name and known accounts, and the previous report of the same kind's totals and per-category amounts so the AI can compare (no previous report, or a "so far" one: no comparison, change is null). Amounts go out in main units.
- Size (my call): one request per report, sized for about 1,000 transactions (the owner had 47 in November 2026), with a larger reply budget than the item batches. A period over the cap fails with a clear message ("Too many transactions for one report"), never a silent cut.
- Reply: one JSON object, fixed shape, per currency where amounts appear:
  - `totals`: money in, money out, net, transaction count; own transfers are left out of these, and of categories, parties and accounts (my call: so spending is not inflated)
  - `own`: transfers between own accounts, in and out totals, and each transfer (from account, to account, amount, date); an unpaired transfer's other side is "Another of your accounts"
  - `categories`: name, amount out (or in), count, share of money out, change vs previous report (percent or null)
  - `parties`: top people and shops, amount in and out, count
  - `accounts`: per account in, out, count
  - `daily`: each day's money out
  - `largest`: up to 5 biggest payments (date, name, amount, category)
  - `fees`: total and count; `cash`: withdrawals total and count
  - `insights`: 3 to 5 short plain sentences
- Validation: the app rejects a reply that is not that shape (missing totals, amounts not positive numbers, unknown categories, dates outside the period, more than the caps on list lengths); a rejected reply is not stored and the report is retried at the next check, at most 3 tries per period; then Reports shows "Couldn't make this report" with Try again, and no more automatic tries (my call: a reply that keeps failing must not keep spending). Amounts are converted to minor units on parse.
- Cost cap: when today's AI limit is reached the report waits for the next day and Reports says so (my call).
- Currencies: every amount section is per currency; the screen shows one section per currency, the notification the currency with the most money out (my call).
- Storage: table `reports(id, kind, period_start, period_end, partial, created_at, json)`, at most 8 weekly and 4 monthly kept (oldest deleted on insert). Schema v6 (also adds the category-set column).
- Notification: one line, for example "Week of 10–16 Nov: out PKR 48,300, top Food & dining". Channel "Reports". On the lock screen it shows only "Your weekly report is ready" (or monthly); the amounts show once the phone is unlocked (my call). Tapping opens Inflow; after unlock the report opens. Needs `POST_NOTIFICATIONS` (asked once from Money or Settings on Android 13+); without it reports are still made and listed.
- Screen: Money gets a "Reports" group (newest first, weekly and monthly). A report screen shows the totals, a category bar chart with shares and change arrows, a daily column chart, tables for parties, accounts, own transfers, largest payments, fees and cash, and the insights. Charts are views sized by value; numbers use the existing amount format.

### What the AI may receive (privacy)
- Categorisation and reports send transaction fields only, never message text. AGENTS.md and the Inflow spec are amended to say so.
- Which transactions (owner, 2026-11-17, "Send both"): every transaction, including ones read from bank app notifications (pushes) and ones from apps or senders kept from the AI. "Keep from AI" still keeps the messages themselves from the AI; Ask AI keeps its current rule.

## Constraints
- Kotlin owns categorisation, scheduling, the AI calls, validation, storage and the notification; RN renders with `@apps-hub/ui`. No new dependency.
- One new permission: `POST_NOTIFICATIONS`. No INTERNET change beyond the owner's AI address.
- Tests: Kotlin JVM tests for the category migration map, the categorisation request/reply parser, the report JSON validator, the schedule (which period is due at a given time, missed checks, Sunday 21:00, month boundaries, time zone), retention of 8 and 4; SQL proven in sqlite3; node tests for chart scaling and labels.

## Left to the builder
- Batch sizes and request caps for categorisation and reports (a month can hold hundreds of transactions).
- Exact prompt wording and JSON key names, within the shape above.
- Chart styling within `@apps-hub/ui` tokens.
