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
