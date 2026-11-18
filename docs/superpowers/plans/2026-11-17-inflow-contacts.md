# Inflow contacts and money parties Implementation Plan

> Execution: native (the controller implements both tasks in order; the owner's rule replaces superpowers:subagent-driven-development with cd-engineering-tools:parallel-agents-coord, not needed for two small sequential tasks). Steps use `- [ ]`.

**Goal:** Chat-like apps open a contact list, and Money lists every person or shop with a drill-down.

**Architecture:** Kotlin SQL groups rows (`SqlItemStore`, `SqlLedgerStore`), `InflowCoreModule` exposes them, `modules/inflow-core/src/index.ts` types them, RN screens render with `@apps-hub/ui`.

**Tech Stack:** Kotlin + SQLCipher (no JVM SQL harness, R32: SQL is proven in desktop `sqlite3` on the real schema), Expo module, React Native, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-17-inflow-contacts-design.md`

## Global Constraints
- No new permission, no new dependency; `:app:processReleaseMainManifest` unchanged.
- Copy: sentence case, no emoji, no ALL-CAPS.
- Hidden OTP items (`VISIBLE_*` clause) never appear in a contact row or count.
- Teams package: `com.microsoft.teams`.

## Review Focus
1. A contact whose newest item is an expired OTP: row must use the newest visible item, or vanish if none is visible.
2. Two contacts with the same `lastAt`: paging must neither skip nor repeat (keyset on `(lastAt, key)`).
3. Owner's own WhatsApp replies ("You") must land in the chat's row, not a "You" row (key = conversation_key first).
4. A renamed SMS number shows the new name in the contact list and in the opened list's title.
5. Transactions with neither label nor counterparty group under "Unknown" and open correctly (party `''`).

---

### Task 1: Kotlin queries and module functions

**Files:**
- Modify: `apps/inflow/modules/inflow-core/android/src/main/java/expo/modules/inflowcore/android/SqlItemStore.kt` (`home` apps rows, `list` filter, new `contacts`)
- Modify: `.../android/SqlLedgerStore.kt` (`money` gets `parties`; new `partyTotals`, `listPartyTxns`)
- Modify: `.../InflowCoreModule.kt`
- Create: `.../core/ContactApps.kt` + test `src/test/.../core/ContactAppsTest.kt`

**Interfaces (Produces):**
- `object ContactApps { const val TEAMS = "com.microsoft.teams"; fun byContact(pkg: String, sms: Set<String>, hasChats: Boolean): Boolean }` — true for sms pkgs, `Email.GMAIL`, TEAMS, or hasChats.
- `SqlItemStore.home(startOfDay, now, sms: Set<String>)`: each app row gains `"byContact": Boolean` (hasChats = `EXISTS(SELECT 1 FROM items c WHERE c.pkg = i.pkg AND c.conversation_key IS NOT NULL)`).
- `SqlItemStore.contacts(pkg: String, startOfDay: Long, now: Long, before: Long?, beforeKey: String?, limit: Int): List<Map>` rows `{key, name, lastText, lastAt, today}`; key = `COALESCE(conversation_key, sender_key)`; name = `COALESCE(sender_names.name for key, conversation, sender, key)`; newest first; keyset `(lastAt < before OR (lastAt = before AND key < beforeKey))`, order `lastAt DESC, key DESC`.
- `SqlItemStore.list` filter `"contact"`: `i.pkg = ? AND COALESCE(i.conversation_key, i.sender_key) = ?` from `filter["pkg"]`, `filter["key"]`.
- `SqlLedgerStore.money` adds `"parties"`: rows `{name: String|null, own: Boolean, currency, moneyIn, moneyOut, count}`; non-own grouped by `COALESCE(label, counterparty, '')` (`''` → name null = Unknown), plus one own row (`own = 1`, name null) when any; order by `moneyIn + moneyOut DESC`.
- `SqlLedgerStore.partyTotals(name: String?, own: Boolean): List<{currency, moneyIn, moneyOut, count}>` all-time.
- `SqlLedgerStore.listPartyTxns(name: String?, own: Boolean, before, limit, beforeId)`: same row shape and paging as `listTxns`. Party clause: own → `t.own = 1`; else `t.own = 0 AND COALESCE(t.label, t.counterparty, '') = ?` (null name binds `''`).
- Module: `Function("contacts") { pkg, startOfDay, before: Long?, beforeKey: String?, limit }`, `Function("partyTotals") { name: String?, own }`, `Function("listPartyTxns") { name: String?, own, before: Long?, limit, beforeId: Long? }`; `home` passes `StoreHolder.smsPackages(context)`.

- [ ] Step 1: write `ContactAppsTest`: sms pkg true; `com.google.android.gm` true; `com.microsoft.teams` true; `com.whatsapp` with hasChats true; `com.daraz.android` false.
- [ ] Step 2: run `./gradlew :inflow-core:testDebugUnitTest --tests '*ContactAppsTest'` → FAIL (unresolved).
- [ ] Step 3: implement `ContactApps`, the queries and the module functions above.
- [ ] Step 4: prove the SQL in desktop sqlite3 on the v5 schema (CREATE statements copied from `SqlItemStore`) with fixture rows covering Review Focus 1-3 and 5; record the outputs in progress.md.
- [ ] Step 5: Gradle `:inflow-core:testDebugUnitTest :app:assembleDebug` → 0 failures; commit.

### Task 2: TS contract and screens

**Files:**
- Modify: `apps/inflow/modules/inflow-core/src/index.ts`, `apps/inflow/App.tsx`, `src/HomeScreen.tsx`, `src/ListScreen.tsx` (none beyond the filter type), `src/MoneyScreen.tsx`
- Create: `src/ContactsScreen.tsx`, `src/PartyScreen.tsx`, `src/party.ts` + `src/__tests__/party.test.ts` (add to `package.json` test script)

**Interfaces (Consumes Task 1):** `AppRow.byContact: boolean`; `ItemFilter` adds `{ kind: 'contact'; pkg: string; key: string }`; `ContactRow { key; name; lastText; lastAt; today }`; `PartyTotal { name: string | null; own: boolean; currency; moneyIn; moneyOut; count }`, `MoneySummary.parties: PartyTotal[]`; api `contacts(pkg, startOfDay, before, beforeKey, limit): ContactRow[]`, `partyTotals(name, own): { currency; moneyIn; moneyOut; count }[]`, `listPartyTxns(name, own, before, limit, beforeId): Txn[]`.

- `party.ts`: `partyTitle(p: { name: string | null; own: boolean }): string` → own: "Between your accounts"; null: "Unknown"; else name. Test those three.
- App routing: the stack holds `{ kind: 'items', filter, title } | { kind: 'contacts', pkg, title } | { kind: 'party', name, own, title }`. Home app row: `byContact` → contacts route, else items route. Back pops as today.
- ContactsScreen: Back + Header(app label); first Group row "All messages" → items route `{kind:'app', pkg}`; FlatList of contact rows (title name, subtitle lastText 1 line, trailing time + "n today"), paged 50 by `(lastAt, key)`; tap → items route `{kind:'contact', pkg, key}` titled with the name; reload on onCaptured.
- MoneyScreen: replace "Where it went" with "People and shops": each party row title `partyTitle`, subtitle "In x · out y · n transactions" (omit a zero side), tap → party route.
- PartyScreen: Back + Header(title); Group of all-time totals per currency (Money in / Money out / Transactions); FlatList of TxnRow (export it from MoneyScreen) paged 50; TxnSheet on tap.

- [ ] Step 1: write `party.test.ts` (three cases) → run `pnpm --filter inflow test` → FAIL.
- [ ] Step 2: implement contract, `party.ts`, screens, routing.
- [ ] Step 3: `pnpm --filter inflow test` and `pnpm --filter inflow typecheck` → 0; commit.
