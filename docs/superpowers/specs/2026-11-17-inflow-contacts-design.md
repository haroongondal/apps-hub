# Inflow: messages and money grouped by contact (owner list item 2)

Approved by the owner on 2026-11-17 ("show only the app's messages", then "go ahead, similar case for transactions and spending").

## Why
The owner wants to find everything from one person or shop quickly. Today an app opens one flat list of every notification, and Money shows only the top 10 shops for money out.

## Goals
- Chat-like apps open a contact list; tapping a contact shows that contact's messages in that app only.
- Money shows every person or shop for the month (money in and out); tapping one shows all transactions with them.

## Non-goals
- One person across apps (owner chose per app).
- Search inside the contact list; merging two spellings of one shop by hand.

## Approaches
1. Group in the database (Kotlin SQL), one row per contact, paged. **Picked**: exact over all history.
2. Group in the screen over the loaded pages (50 at a time). Rejected: older contacts would be missing.

## Design

### Messages
- An app opens a contact list when it is an SMS app, Gmail, Teams (`com.microsoft.teams`), or any app with at least one chat item (`conversation_key` set, e.g. WhatsApp, WhatsApp Business). Every other app keeps today's flat list.
- Contact key = `COALESCE(conversation_key, sender_key)`: a chat (1:1 or group) stays one row and includes the owner's own replies; SMS by number; email by sender.
- Row: name (Rename wins, then chat title, then sender), last message, time, count today. Newest first, keyset paged on (last time, key).
- Top row "All messages" opens today's flat app list.
- Tap opens the existing list screen with a new filter `{ kind: 'contact', pkg, key }` (same item sheet, rename, media).
- Home's "Messages" block (5 latest chats) is unchanged.

### Money
- The "Where it went" block (top 10, money out) becomes "People and shops": every counterparty in the selected month, money in and money out, count, sorted by total moved. Name = AI clean name, else the bank's counterparty text; transactions with neither group under "Unknown".
- Own transfers are one separate row, "Between your accounts", with in/out totals (also feeds the item 4 reports).
- Tap opens a transaction list for that name across all months, newest first, with all-time in/out totals on top; the existing transaction sheet opens from it.

## Constraints
- Kotlin owns the queries; RN only renders with `@apps-hub/ui`. No new permission, no new dependency.
- Tests: Kotlin JVM/SQL tests for the grouping and the new filters; node tests for any TS helper.

## Left to the builder (my calls)
- Two spellings of one shop without an AI name stay two rows until the AI names them.
- The contact list for an app is not limited by date; Money's grouping follows the selected month.
