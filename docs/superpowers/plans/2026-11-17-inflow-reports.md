# Inflow categories and reports Implementation Plan

> **For agentic workers:** the owner's rule replaces superpowers:subagent-driven-development with `cd-engineering-tools:parallel-agents-coord`. Agent K (Kotlin, tasks K1-K4, in order) and agent T (TS, task T1) run in parallel; their files are disjoint. Steps use `- [ ]`.

**Goal:** Every transaction gets a category (owner can change it), and the AI makes weekly and monthly money reports as JSON that the app validates, stores, notifies about and draws as tables and charts.

**Architecture:** Pure Kotlin in `core/` (category list, categorisation request/parse, report schedule, report request/validation, report run) behind small store interfaces; Android glue in `android/` (SQL stores, AiRunner hook, notification, permission); module functions in `InflowCoreModule`; RN renders.

**Tech Stack:** Kotlin + kotlinx.serialization + SQLCipher (no JVM SQL harness, R32: SQL proven in desktop sqlite3), Expo modules API, React Native + `@apps-hub/ui`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-17-inflow-reports-design.md`

## Global Constraints
- One new permission: `android.permission.POST_NOTIFICATIONS` (minSdk is 33, so it is a runtime permission). No new dependency. No change to INTERNET.
- AI requests for categories and reports carry transaction fields only (id, direction, amount, currency, account, name, date, own, category), for every transaction (owner: "Send both"); never item or message text. Ask AI keeps its current rule.
- Nothing logs prompts, replies, amounts or names (AiRunner's existing rule).
- Copy: sentence case, plain words, no emoji, no ALL-CAPS.
- Weekly period: Sunday 21:00 to the next Sunday 21:00, local time; monthly: calendar month. Keep 8 weekly and 4 monthly (non-partial) reports.
- At most 3 tries per report period; ~1,000 transactions per report request (`ReportJson.MAX_TXNS = 1000`).

## Shared names (both agents)

Categories (exact strings, this order):
- Out: `Food & dining, Groceries, Shopping, Mobile & internet, Bills & utilities, Rent, Transport, Fuel, Health, Education, Entertainment, Travel, Family, Charity, Sent to people, Fees & charges, Cash withdrawal, Other`
- In: `Salary, Received from people, Refund, Other income`
- Migration of old values: `Food`→`Food & dining`, `Bills`→`Bills & utilities`, `Fees`→`Fees & charges`; a money-in txn whose category is not an In category gets NULL.

Stored report JSON (amounts are integers in minor units; dates `YYYY-MM-DD` local):
```json
{"currencies":[{"currency":"PKR",
  "totals":{"in":0,"out":0,"net":0,"count":0},
  "own":{"in":0,"out":0,"transfers":[{"from":"","to":"","amount":0,"date":""}]},
  "categories":[{"name":"","direction":"out","amount":0,"count":0,"share":0.0,"change":null}],
  "parties":[{"name":"","in":0,"out":0,"count":0}],
  "accounts":[{"name":"","in":0,"out":0,"count":0}],
  "daily":[{"date":"","out":0}],
  "largest":[{"date":"","name":"","amount":0,"category":""}],
  "fees":{"amount":0,"count":0},"cash":{"amount":0,"count":0}}],
 "insights":[""]}
```
The AI replies with the same shape but amounts in main units (numbers, e.g. 1500.5). `share` and `change` are percent numbers; `change` null when there is nothing to compare.

TS contract (agent T writes it in `modules/inflow-core/src/index.ts`; agent K implements it):
```ts
export type ReportKind = 'weekly' | 'monthly';
export interface ReportRow { id: number; kind: ReportKind; periodStart: number; periodEnd: number; partial: boolean;
  createdAt: number; status: 'ready' | 'waiting' | 'failed'; message: string | null; headline: string | null }
export interface ReportData { /* the stored JSON above, typed */ }
// api additions
categories(): { out: string[]; in: string[] };
setCategory(txnId: number, category: string | null): void;   // null = back to the AI's choice
listReports(): ReportRow[];                                    // newest period first
getReport(id: number): { row: ReportRow; data: ReportData | null } | null;
makeReportNow(): Promise<{ ok: boolean; message: string | null }>;   // weekly, partial, the week so far
retryReport(id: number): Promise<{ ok: boolean; message: string | null }>;
notificationsAllowed(): boolean;
askNotifications(): Promise<boolean>;
takeOpenReport(): number | null;   // report id from a tapped notification, cleared once read
```
`Txn` gains `categorySet: boolean`. `headline` is the notification line ("Week of 10–16 Nov: out PKR 48,300.00, top Food & dining"), null until ready.

## Review Focus
1. Phone off across Sunday 21:00 (and across two Sundays): only the most recent ended week is made, once; a later tick does not remake it.
2. An AI reply wrapped in ```json fences or with prose around it is read; amounts given as strings with commas, negative, zero or missing are rejected (whole reply).
3. The owner sets a category, then the item AI run or the categoriser returns a category for that txn: the owner's stays.
4. Notification permission denied: the report is still stored and listed; nothing throws.
5. A week with no transactions: a ready report with zero totals and the insight "No transactions in this period.", without an AI call.

---

### Task K1: Category list, schema v6, owner category

**Files:** Create `core/Categories.kt`, test `CategoriesTest.kt`; modify `core/Ai.kt` (prompt + money category per direction), `android/SqlItemStore.kt` (SCHEMA_VERSION 6, `SCHEMA_V6`), `android/SqlLedgerStore.kt` (`setAiDetails` guard, `setCategory`, `categorySet` in list rows), `core/Ledger.kt` (`LedgerStore.setCategory`), `MemoryLedgerStore.kt`, `InflowCoreModule.kt` (`categories`, `setCategory`). (Paths under `apps/inflow/modules/inflow-core/android/src/{main,test}/java/expo/modules/inflowcore/`.)

**Interfaces (Produces):** `object Categories { val OUT: List<String>; val IN: List<String>; fun forDirection(d: Direction): List<String>; fun fallback(d: Direction): String /* "Other" | "Other income" */; fun migrate(old: String?, d: Direction): String? }`; `LedgerStore.setCategory(id: Long, category: String?)` (sets `category_set` = category != null; null also clears category so the AI fills it again); `setAiDetails` never changes `category` when `category_set = 1` (label still updates).

SCHEMA_V6: `ALTER TABLE txns ADD COLUMN category_set INTEGER NOT NULL DEFAULT 0`; `ALTER TABLE txns ADD COLUMN category_tries INTEGER NOT NULL DEFAULT 0`; the three renames; NULL for IN txns whose category is not in `Categories.IN`; `CREATE TABLE reports(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, period_start INTEGER NOT NULL, period_end INTEGER NOT NULL, partial INTEGER NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL, message TEXT, tries INTEGER NOT NULL DEFAULT 0, headline TEXT, json TEXT)`; `CREATE UNIQUE INDEX reports_period ON reports(kind, period_start, partial)`.

- [ ] Step 1: `CategoriesTest`: OUT has 18 and IN 4 entries with the exact strings; `migrate("Food", OUT) == "Food & dining"`, `migrate("Bills", OUT) == "Bills & utilities"`, `migrate("Fees", OUT) == "Fees & charges"`, `migrate("Groceries", OUT) == "Groceries"`, `migrate("Food", IN) == null`, `migrate("Salary", IN) == "Salary"`; `fallback(IN) == "Other income"`. `AiBatchTest`: a money-in reply with category "Food & dining" parses with category "Other income"; a money-out reply with "Mobile & internet" keeps it; the system prompt lists both halves. `LedgerTest` (MemoryLedgerStore): after `setCategory(id, "Rent")`, `setAiDetails(id, "Food & dining", "KFC")` leaves category "Rent" and sets label "KFC"; `setCategory(id, null)` then `setAiDetails` sets the AI's.
- [ ] Step 2: run `./gradlew :inflow-core:testDebugUnitTest` → the new tests fail.
- [ ] Step 3: implement; the SQL migration renames run as `UPDATE txns SET category = ? WHERE category = ?`.
- [ ] Step 4: prove SCHEMA_V6 in sqlite3 on a v5 db with rows (renames, IN cleared, reports table, unique index); Gradle green; commit.

### Task K2: Categorise every transaction

**Files:** Create `core/TxnCategorize.kt`, test `TxnCategorizeTest.kt`; modify `core/Ledger.kt` (`LedgerStore.uncategorized(limit: Int): List<Txn>`, `LedgerStore.categoryTried(ids: List<Long>)`), `SqlLedgerStore.kt`, `MemoryLedgerStore.kt`, `android/AiRunner.kt` (after `AiRun.run()` in `execute`).

**Interfaces (Produces):** `class TxnCategorize(store: LedgerStore, provider: () -> OpenAiCompatProvider?, spend: (AiReply) -> Unit, capReached: () -> Boolean, zone: ZoneId) { fun run(maxBatches: Int = 5): Int /* txns categorised */ }`; `object TxnCategorize.Prompt { fun system(): String; fun user(txns: List<Txn>, zone: ZoneId): String; fun parse(reply: String, sent: List<Txn>): Map<Long, Pair<String, String?>> }`. `uncategorized` = `category IS NULL AND category_set = 0 AND category_tries < 3`, newest first. Batch size 100. Every sent id gets `categoryTried` (tries + 1) unless the reply categorised it.

- [ ] Step 1: tests: `parse` keeps only sent ids, maps an unknown or wrong-direction category to `Categories.fallback(direction)`, takes a clean name ≤100 chars or null, survives ```json fences, returns empty map on non-JSON; `user()` contains no `itemIds` and one line per txn with id, direction, amount in main units, account, name, date; `run` with a fake provider: categorises, stops when `capReached()`, an id the model omitted ends with `category_tries = 1` and is retried, after 3 tries it is no longer fetched.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement; reply shape `{"txns":[{"id":1,"category":"...","name":"..."}]}`; results go through `setAiDetails` (owner-set guard applies).
- [ ] Step 4: Gradle green; commit.

### Task K3: Report schedule, request and validation (pure)

**Files:** Create `core/Reports.kt` (`ReportSchedule`, `ReportJson`, `ReportRun`, `ReportStore`), tests `ReportScheduleTest.kt`, `ReportJsonTest.kt`, `ReportRunTest.kt`, `MemoryReportStore.kt`.

**Interfaces (Produces):**
- `enum class ReportKind { WEEKLY, MONTHLY }`; `data class Period(val kind: ReportKind, val start: Long, val end: Long, val partial: Boolean)`.
- `object ReportSchedule { fun lastWeek(now: Long, zone: ZoneId): Period; fun weekSoFar(now: Long, zone: ZoneId): Period; fun lastMonth(now: Long, zone: ZoneId): Period; fun label(p: Period, zone: ZoneId): String /* "Week of 10–16 Nov" | "November 2026" */ }`.
- `object ReportJson { const val MAX_TXNS = 1000; fun system(): String; fun user(p: Period, txns: List<Txn>, previous: String?, ownerName: String?, accounts: List<String>, zone: ZoneId): String; fun parse(reply: String, p: Period, zone: ZoneId): String? /* normalized stored JSON or null */; fun headline(p: Period, json: String, zone: ZoneId): String }`.
- `interface ReportStore { fun row(p: Period): ReportRow?; fun save(p: Period, status: String, message: String?, tries: Int, headline: String?, json: String?, now: Long): Long; fun previousJson(kind: ReportKind, before: Long): String?; fun txns(from: Long, to: Long): List<Txn>; fun prune(); fun deletePartial(kind: ReportKind) }` (`ReportRow` = Kotlin data class mirroring the TS one).
- `class ReportRun(store, provider: () -> OpenAiCompatProvider?, spend, capReached, ownerName: () -> String?, accounts: () -> List<String>, now: () -> Long, zone, notify: (Long, String) -> Unit) { fun runDue(); fun make(p: Period, manual: Boolean): Pair<Boolean, String?> }`.

Rules: `runDue` checks `lastWeek` then `lastMonth`; a period is skipped when its row is `ready`, or `failed` with tries ≥ 3, or the AI is off. Zero txns → ready, zero totals, insight "No transactions in this period.", no AI call. More than MAX_TXNS → failed "Too many transactions for one report.", tries 3. Cap reached → `waiting` "Waiting for tomorrow: today's AI limit is reached." (no try counted). AiError AUTH/OFFLINE/SERVER → `waiting` with the error copy (no try counted). BAD_REQUEST or a reply `parse` rejects → tries + 1, status `failed` with "Couldn't make this report." once tries reach 3, else `waiting` "Inflow will try again soon.". Ready non-partial weekly → `deletePartial(WEEKLY)`, `prune()` (keep 8 weekly, 4 monthly, newest by period_start), `notify(id, headline)` (not for manual/partial ones). `make(manual = true)` resets tries.

Validation (`parse`): first `{` to last `}`; `currencies` 1..5, currency 3 uppercase letters; every amount a JSON number > 0 (0 allowed only in totals, own, fees, cash, daily), at most 2 decimals, converted with BigDecimal like `AiBatch`; category names in `Categories` for their direction; dates inside the period; caps: categories 22, parties 15, accounts 20, daily 32, largest 5, transfers 50, insights 1..5 (each ≤ 200 chars), names ≤ 100 chars; anything else → null.

- [ ] Step 1: `ReportScheduleTest` (zone Asia/Karachi): now Sun 16 Nov 2026 21:30 → lastWeek = Sun 9 Nov 21:00..Sun 16 Nov 21:00, label "Week of 10–16 Nov"; now Sun 16 Nov 20:59 → the week ending 9 Nov; now Mon 1 Dec 00:10 → lastMonth = 1 Nov..1 Dec, label "November 2026"; a week across months labels "Week of 27 Oct–2 Nov"; weekSoFar(Wed) starts at the last Sunday 21:00 and is partial. `ReportJsonTest`: a valid reply in fences → normalized JSON with minor units (1500.5 → 150050); rejects: amount "1,500" string, negative, 3 decimals, unknown category, date outside the period, 6 insights, missing totals; `user()` contains no message text and the previous JSON when given; `headline` = "Week of 10–16 Nov: out PKR 48,300.00, top Food & dining" for a fixture. `ReportRunTest` with `MemoryReportStore` and a fake provider: Review Focus 1, 5; cap → waiting, no try; three bad replies → failed, a fourth tick makes no call; ready weekly deletes the partial and notifies once; prune keeps 8/4.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement. `OpenAiCompatProvider.complete` gains `maxTokens: Int = MAX_TOKENS`; reports pass 16_000.
- [ ] Step 4: Gradle green; commit.

### Task K4: Android glue (store, tick, notification, module)

**Files:** Create `android/SqlReportStore.kt`, `android/ReportNotifier.kt`; modify `android/AiRunner.kt` (`execute` calls `ReportRun.runDue()` after categorising; `makeReportNow`, `retryReport` on the AI executor), `InflowCoreModule.kt`, `modules/inflow-core/android/src/main/AndroidManifest.xml` (POST_NOTIFICATIONS).

- `ReportNotifier.notify(ctx, reportId, headline, kind)`: channel id `reports`, name "Reports"; `VISIBILITY_PRIVATE` with a public version whose text is "Your weekly report is ready" / "Your monthly report is ready"; tap → launch intent of the app with extra `inflow.reportId`; skipped silently when not allowed.
- Module: functions of the TS contract; `takeOpenReport` reads `inflow.reportId` from the current activity's intent and from `OnNewIntent`, then clears it; `askNotifications` uses the Expo permissions manager for POST_NOTIFICATIONS.
- [ ] Step 1: prove `SqlReportStore` SQL in sqlite3 (save/upsert on the unique index, prune 8/4, previousJson, deletePartial).
- [ ] Step 2: implement; Gradle `:inflow-core:testDebugUnitTest :app:assembleDebug` green; `:app:processReleaseMainManifest` shows exactly one new permission (POST_NOTIFICATIONS) and no INTERNET; commit.

### Task T1: TS contract and screens

**Files:** modify `modules/inflow-core/src/index.ts`, `App.tsx`, `src/TxnSheet.tsx`, `src/MoneyScreen.tsx`, `src/SettingsScreen.tsx`; create `src/ReportScreen.tsx`, `src/report.ts`, `src/__tests__/report.test.ts` (add to `package.json` test script).

- `report.ts`: `barFraction(value: number, max: number): number` (0..1, 0 when max ≤ 0); `changeLabel(change: number | null): string | null` ("Up 38%", "Down 12%", "Same as before" for |change| < 0.5, null for null); `reportTitle(row: ReportRow): string` ("Week of 10–16 Nov", "November 2026", "+ (so far)" when partial; week dates are Monday..Sunday of the period end, local time).
- TxnSheet: Category row opens a picker of `categories()` for the txn's direction plus "Let the AI choose" (calls `setCategory(id, null)`); shows "Set by you" when `categorySet`.
- Money: "Reports" group under the month header: rows from `listReports()` (title `reportTitle`, subtitle headline or message, tone muted for waiting, warn for failed with a Try again button), a "Make a report now" button (busy while running, shows the message on failure); and, when `!notificationsAllowed()`, a row "Get a notification when a report is ready" that calls `askNotifications()`.
- ReportScreen (pushed route `{ kind: 'report'; id; title }`): per currency: totals (In, Out, Net, Transactions); "Where it went" bar rows per category (name, amount, share %, `changeLabel`), bar width = `barFraction(amount, max)` as a View with `c.accent` fill; "By day" columns (7 or up to 31 bars, height from `barFraction`, day labels); tables (Groups of Rows) for People and shops, Accounts, Between your accounts (totals + each transfer), Largest payments, Fees and cash; then "What stands out" with the insights.
- App: after unlock and on AppState active, `takeOpenReport()` → push the report route.
- [ ] Step 1: `report.test.ts`: `barFraction(5,10)=0.5`, `(3,0)=0`, `(12,10)=1`; `changeLabel(38)="Up 38%"`, `(-12.4)="Down 12%"`, `(0.2)="Same as before"`, `(null)=null`; `reportTitle` weekly/monthly/partial with TZ=Asia/Karachi → FAIL.
- [ ] Step 2: implement; `pnpm --filter inflow test` and `pnpm --filter inflow typecheck` → 0; commit.

### Task D: docs (controller)
- AGENTS.md Inflow entry and the Inflow spec: categories and reports send transaction fields of every transaction (never message text); POST_NOTIFICATIONS; reports kept 8/4.
