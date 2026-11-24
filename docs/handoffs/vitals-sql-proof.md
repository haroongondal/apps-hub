# Vitals V1 sqlite3 proof (desktop sqlite3 3.50.6, real schema v1..v9)

Setup: `v1to8.sql` is SCHEMA_V1..V8 extracted mechanically from the string literals in `SqlItemStore.kt` (20 tables, `user_version` 8). SCHEMA_V9 and the four statements are the exact text of `SqlItemStore.SCHEMA_V9` and the `SqlHealthStore` constants (extracted the same way), bound with `.param set` like the Kotlin binds them. `HealthSqlWiringTest` pins the same text; `HealthAggregateTest.saveReplacesTheWindowAndKeeps400Days` runs the same fixture through the `MemoryHealthStore` twin and expects the same rows.

Statements:

```sql
CREATE TABLE health_daily(day TEXT PRIMARY KEY, steps INTEGER, sleep_minutes INTEGER, hr_avg INTEGER, hr_low INTEGER, updated_at INTEGER NOT NULL)
DELETE FROM health_daily WHERE day >= ? AND day <= ?                                   -- DELETE_RANGE
INSERT INTO health_daily(day, steps, sleep_minutes, hr_avg, hr_low, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET steps = excluded.steps, sleep_minutes = excluded.sleep_minutes, hr_avg = excluded.hr_avg, hr_low = excluded.hr_low, updated_at = excluded.updated_at   -- UPSERT
DELETE FROM health_daily WHERE day < ?                                                 -- PRUNE (keepFrom = last day - 399)
SELECT day, steps, sleep_minutes, hr_avg, hr_low FROM health_daily WHERE day >= ? AND day <= ? ORDER BY day   -- RANGE
```

Output (`|` separated, no header):

```
== upgrade v8 to v9 in one transaction, as ensureSchema
9
CREATE TABLE health_daily(day TEXT PRIMARY KEY, steps INTEGER, sleep_minutes INTEGER, hr_avg INTEGER, hr_low INTEGER, updated_at INTEGER NOT NULL);
== fixtures written with UPSERT (now=10)
2025-02-08|1||||10
2025-02-09|2||||10
2026-03-01|3||||10
2026-03-09|4||||10
== replaceDays(first 2026-03-09, last 2026-03-15, rows [2026-03-10 500|420|71|65], keepFrom 2025-02-09, now 77)
2025-02-09|2||||10
2026-03-01|3||||10
2026-03-10|500|420|71|65|77
== UPSERT conflict: 2026-03-10 again, steps 900, sleep NULL, now 88
2026-03-10|900|NULL|71|65|88
== RANGE(2026-03-01, 2026-03-31)
2026-03-01|3|||
2026-03-10|900||71|65
== updated_at NOT NULL holds
Runtime error near line 60: NOT NULL constraint failed: health_daily.updated_at (19)
```

Read: the stale 2026-03-09 row inside the window went, rows outside it stayed, the 400-day cut removed only 2025-02-08, NULL stays NULL (no data for that metric), and the conflict path updates in place.

# Vitals V2/V3 sqlite3 proof (desktop sqlite3 3.50.6, real schema v1..v10)

Setup: SCHEMA_V1..V10 and every `SqlMedicineStore` / `SqlJournalStore` constant extracted mechanically from the string literals in the Kotlin sources (`+` joins and `$COLUMNS` resolved), v1..v9 run and `user_version` set to 9, then the v10 block run in one transaction with the version bump, as `ensureSchema` does. Parameters bound with `.param set` like the Kotlin binds them (NULL for a null end day). `VitalsSqlWiringTest` pins the same SCHEMA_V10 text; `MedicinesTest` and `JournalTest` run the same behaviour through the `MemoryMedicineStore` / `MemoryJournalStore` twins. The delete runs DELETE_LOG then DELETE inside one transaction, as `SqlMedicineStore.delete` does through `SqlItemStore.inTransaction`.

Statements:

```sql
CREATE TABLE medicines(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, dose TEXT NOT NULL, times TEXT NOT NULL, days TEXT NOT NULL, start_day TEXT NOT NULL, end_day TEXT, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)
CREATE TABLE dose_log(medicine_id INTEGER NOT NULL, due_at INTEGER NOT NULL, status TEXT NOT NULL, marked_at INTEGER NOT NULL, PRIMARY KEY(medicine_id, due_at))
CREATE TABLE journal(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, mood INTEGER NOT NULL, tags TEXT NOT NULL, note TEXT NOT NULL, created_at INTEGER NOT NULL)
CREATE INDEX journal_at ON journal(at)
SELECT id, name, dose, times, days, start_day, end_day, active, created_at FROM medicines ORDER BY active DESC, name COLLATE NOCASE, id   -- SqlMedicineStore.ALL
SELECT id, name, dose, times, days, start_day, end_day, active, created_at FROM medicines WHERE id = ?   -- SqlMedicineStore.ONE
INSERT INTO medicines(name, dose, times, days, start_day, end_day, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)   -- SqlMedicineStore.INSERT
UPDATE medicines SET name = ?, dose = ?, times = ?, days = ?, start_day = ?, end_day = ? WHERE id = ?   -- SqlMedicineStore.UPDATE
UPDATE medicines SET active = 0 WHERE id = ?   -- SqlMedicineStore.STOP
DELETE FROM dose_log WHERE medicine_id = ?   -- SqlMedicineStore.DELETE_LOG
DELETE FROM medicines WHERE id = ?   -- SqlMedicineStore.DELETE
SELECT medicine_id, due_at, status, marked_at FROM dose_log WHERE due_at >= ? AND due_at < ? ORDER BY due_at, medicine_id   -- SqlMedicineStore.LOG_RANGE
INSERT INTO dose_log(medicine_id, due_at, status, marked_at) VALUES (?, ?, ?, ?) ON CONFLICT(medicine_id, due_at) DO UPDATE SET status = excluded.status, marked_at = excluded.marked_at   -- SqlMedicineStore.MARK
INSERT OR IGNORE INTO dose_log(medicine_id, due_at, status, marked_at) VALUES (?, ?, 'missed', ?)   -- SqlMedicineStore.MISSED
SELECT id, at, mood, tags, note FROM journal WHERE at < ? ORDER BY at DESC, id DESC LIMIT ?   -- SqlJournalStore.PAGE
INSERT INTO journal(at, mood, tags, note, created_at) VALUES (?, ?, ?, ?, ?)   -- SqlJournalStore.INSERT
UPDATE journal SET at = ?, mood = ?, tags = ?, note = ? WHERE id = ?   -- SqlJournalStore.UPDATE
DELETE FROM journal WHERE id = ?   -- SqlJournalStore.DELETE
```

Output (`|` separated, no header):

```
== upgrade v9 to v10 in one transaction, as ensureSchema
10
CREATE TABLE medicines(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, dose TEXT NOT NULL, times TEXT NOT NULL, days TEXT NOT NULL, start_day TEXT NOT NULL, end_day TEXT, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE dose_log(medicine_id INTEGER NOT NULL, due_at INTEGER NOT NULL, status TEXT NOT NULL, marked_at INTEGER NOT NULL, PRIMARY KEY(medicine_id, due_at));
CREATE TABLE journal(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, mood INTEGER NOT NULL, tags TEXT NOT NULL, note TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX journal_at ON journal(at);
== INSERT two medicines (the second ends 2026-03-31), then ALL (active first, by name)
1
2
2|Antibiotic|5 ml|09:00|1,3,5|2026-03-01|2026-03-31|1|200
1|Vitamin D|1 tablet|08:00,20:00|1,2,3,4,5,6,7|2026-03-01||1|100
== UPDATE 1 (name, times), STOP 2, ONE 1, ALL: stopped last, created_at and active unchanged by UPDATE
1|Vitamin D3|1 tablet|09:00|1,2,3,4,5,6,7|2026-03-01||1|100
1|Vitamin D3|1 tablet|09:00|1,2,3,4,5,6,7|2026-03-01||1|100
2|Antibiotic|5 ml|09:00|1,3,5|2026-03-01|2026-03-31|0|200
== MARK taken, MARK again as skipped (overwrites, marked_at moves), MISSED on the marked dose (ignored), MISSED on a new dose
== LOG_RANGE [1000, 2000): due_at 2000 is excluded
1|1000|skipped|1020
2|1500|taken|1510
== LOG_RANGE [0, 9999)
1|1000|skipped|1020
2|1500|taken|1510
1|2000|missed|2040
== MARK corrects the missed dose to taken
1|2000|taken|3000
== delete medicine 1 in one transaction (DELETE_LOG then DELETE): its log goes, medicine 2 and its log stay
2|Antibiotic|5 ml|09:00|1,3,5|2026-03-01|2026-03-31|0|200
2|1500|taken|1510
== journal INSERT x3 (two share at=500), then PAGE(beforeAt = max, limit 2) and PAGE(beforeAt 500, 10)
3|500|2||Note, with comma
2|500|4|headache,low mood|
1|400|3|tired|Slept late
== UPDATE 1 (mood 5, no tags), UPDATE 99 changes nothing, DELETE 2, PAGE all
1
0
3|500|2||Note, with comma
1|400|5||Better
== PAGE uses the journal_at index
QUERY PLAN
`--SEARCH journal USING INDEX journal_at (at<?)
== dose_log key holds: a plain second insert of (2, 1500) fails
Runtime error near line 233: UNIQUE constraint failed: dose_log.medicine_id, dose_log.due_at (19)
== NOT NULL holds: medicines.created_at, journal.mood
Runtime error near line 235: NOT NULL constraint failed: medicines.created_at (19)
Runtime error near line 236: NOT NULL constraint failed: journal.mood (19)
```

Read: v10 lands in the upgrade transaction (user_version 10); UPDATE leaves active and created_at alone and STOP keeps the row (stopped sorts last); MARK overwrites status and marked_at, MISSED never overwrites a mark and is idempotent, and MARK corrects a missed dose to taken; LOG_RANGE is half-open; deleting a medicine takes its log and nothing else; tags are comma-joined (no fixed tag holds a comma) while a note may hold commas; PAGE is newest first with id breaking ties and searches the journal_at index; the dose_log key and the NOT NULL columns hold.
