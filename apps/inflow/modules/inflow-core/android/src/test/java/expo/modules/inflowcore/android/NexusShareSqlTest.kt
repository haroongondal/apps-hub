package expo.modules.inflowcore.android

import expo.modules.inflowcore.core.AUTOPILOT_META
import expo.modules.inflowcore.core.AutopilotSettings
import expo.modules.inflowcore.core.NexusShares
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

// No JVM SQLite (R32), so the Nexus share SQL runs in the sqlite3 command line over the real schema (v1 to v10); skipped where no sqlite3 exists.
class NexusShareSqlTest {
  private val sqlite = listOf("/usr/bin/sqlite3", "/opt/homebrew/bin/sqlite3").firstOrNull { File(it).canExecute() }
  private val schema = listOf(
    SqlItemStore.SCHEMA_V1, SqlItemStore.SCHEMA_V2, SqlItemStore.SCHEMA_V3, SqlItemStore.SCHEMA_V4, SqlItemStore.SCHEMA_V5,
    SqlItemStore.SCHEMA_V6, SqlItemStore.SCHEMA_V7, SqlItemStore.SCHEMA_V8, SqlItemStore.SCHEMA_V9, SqlItemStore.SCHEMA_V10,
  ).flatten().joinToString("") { "$it;\n" }

  private fun rows(setup: String, query: String, vararg args: Any): List<List<String>> {
    assumeTrue("sqlite3 not found", sqlite != null)
    val bound = args.fold(query) { s, a -> s.replaceFirst("?", a.toString()) }
    assertFalse("unbound parameter in $bound", bound.contains("?"))
    val p = ProcessBuilder(sqlite, "-bail", "-batch", "-separator", "|", ":memory:").redirectErrorStream(true).start()
    p.outputStream.use { it.write(".nullvalue NULL\n$schema$setup\n$bound;\n".toByteArray()) }
    val out = p.inputStream.bufferedReader().readText()
    assertEquals(out, 0, p.waitFor())
    return out.lines().filter { it.isNotEmpty() }.map { it.split("|") }
  }

  private fun q(s: String?) = if (s == null) "NULL" else "'${s.replace("'", "''")}'"

  private fun item(id: Long, pkg: String, text: String, sms: Boolean = false, email: Boolean = false, otp: Boolean = false, senderKey: String? = null, emailText: String? = null, conv: String? = null) =
    "INSERT INTO items(id, hash, pkg, app_label, sender, sender_key, conversation_key, text, posted_at, captured_at, search, otp_expires_at, sms_hash, email_hash, email_text) " +
      "VALUES ($id, 'h$id', ${q(pkg)}, 'App', 'Ali', ${q(senderKey)}, ${q(conv)}, ${q(text)}, $id, $id, '', ${if (otp) "9999999999999" else "NULL"}, " +
      "${if (sms) "'s$id'" else "NULL"}, ${if (email) "'e$id'" else "NULL"}, ${q(emailText)});\n"

  private val sms = "com.google.android.apps.messaging"
  private val healthCanary =
    "INSERT INTO health_daily(day, steps, updated_at) VALUES ('HEALTH CANARY', 6214, 1);\n" +
      "INSERT INTO medicines(name, dose, times, days, start_day, created_at) VALUES ('HEALTH CANARY', '1', '08:00', '1', '2026-11-01', 1);\n" +
      "INSERT INTO journal(at, mood, tags, note, created_at) VALUES (1, 3, '', 'HEALTH CANARY', 1);\n"

  private val mixed = item(1, sms, "sms ok", sms = true) +
    item(2, sms, "Your code is 123456", sms = true, otp = true) +
    item(3, "com.whatsapp", "picked chat", conv = "k3") +
    item(4, "com.google.android.gm", "subject", email = true, emailText = "full email") +
    item(5, "com.haroon.strongroom", "vault", sms = true) +
    item(6, "com.haroon.inflow", "own", email = true) +
    item(7, sms, "blocked sender", sms = true, senderKey = "num:999") + "INSERT INTO ai_blocks VALUES ('sender:num:999');\n" +
    item(8, "com.bank.app", "not recorded", sms = true) + "INSERT INTO apps VALUES ('com.bank.app', 'Bank', 0, NULL);\n" +
    item(9, "com.other", "blocked app", sms = true) + "INSERT INTO ai_blocks VALUES ('app:com.other');\n" +
    item(10, sms, "renamed", sms = true, senderKey = "num:1") + "INSERT INTO sender_names VALUES ('num:1', 'Ali', 'Ammi');\n" +
    "INSERT INTO meta VALUES ('$AUTOPILOT_META', ${q(AutopilotSettings(pickedChats = setOf("com.whatsapp|k3")).toJson())});\n" +
    healthCanary

  @Test fun askItemsServeOnlySmsAndEmailThatAskAiMayReadAndNoHealth() {
    val served = rows(mixed, SqlItemStore.NEXUS_ASK_ITEMS_SQL, 0, 0, NexusShares.PAGE)
    assertEquals(listOf(listOf("1", "App", "Ali", "sms ok", "1"), listOf("4", "App", "Ali", "full email", "4"), listOf("10", "App", "Ammi", "renamed", "10")), served)
    assertFalse(served.flatten().any { it.contains("HEALTH CANARY") || it == "6214" })
  }

  @Test fun askIdsAreTheIdsAskItemsWouldServe() =
    assertEquals(listOf("1", "4", "10"), rows(mixed, SqlItemStore.NEXUS_ASK_IDS_SQL, 0, 0, NexusShares.PAGE).map { it.single() })

  // posted_at of the fixture rows equals the id, so a first-key time of 5 leaves out rows 1 to 4; with no key the store answers nothing before any SQL runs.
  @Test fun nothingSavedBeforeTheFirstAiKeyIsServed() {
    assertEquals(listOf("10"), rows(mixed, SqlItemStore.NEXUS_ASK_IDS_SQL, 0, 5, NexusShares.PAGE).map { it.single() })
    assertEquals(listOf("10"), rows(mixed, SqlItemStore.NEXUS_ASK_ITEMS_SQL, 0, 5, NexusShares.PAGE).map { it[0] })
    assertEquals(listOf("4", "10"), rows(mixed, SqlItemStore.NEXUS_ASK_IDS_SQL, 0, 4, NexusShares.PAGE).map { it.single() })   // the edge is included, like Ask AI
    assertEquals(emptyList<List<String>>(), rows(mixed, SqlItemStore.NEXUS_ASK_ITEMS_SQL, 0, 11, NexusShares.PAGE))
  }

  @Test fun withNoAiKeyTheClauseAloneServesNothing() {
    assertEquals(emptyList<List<String>>(), rows(mixed, SqlItemStore.NEXUS_ASK_IDS_SQL, 0, "NULL", NexusShares.PAGE))
    assertEquals(emptyList<List<String>>(), rows(mixed, SqlItemStore.NEXUS_ASK_ITEMS_SQL, 0, "NULL", NexusShares.PAGE))
  }

  // No sqlite3 needed: with no AI key the store returns empty before any query.
  @Test fun withNoAiKeyTheStoreDoesNotEvenQuery() {
    val src = File("src/main/java/expo/modules/inflowcore/android/SqlItemStore.kt").readText()
    for (fn in listOf("fun nexusAskItems(sinceId: Long, limit: Int)", "fun nexusAskIds(sinceId: Long, limit: Int)")) {
      val body = src.substringAfter(fn).substringBefore("\n  }\n").lines().map { it.trim() }.filter { it.isNotEmpty() }
      assertEquals(fn, "val from = enabledSince() ?: return emptyList()", body[1])
      assertTrue(fn, body[2].startsWith("return query(NEXUS_ASK_") && body[2].contains("_SQL, sinceId, from, limit.toLong())"))
    }
  }

  private val many = "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 250) " +
    "INSERT INTO items(id, hash, pkg, app_label, text, posted_at, captured_at, search, sms_hash) SELECT x, 'h' || x, '$sms', 'App', 'm' || x, x, x, '', 's' || x FROM n;\n"

  @Test fun pagesAreIdsStrictlyAboveTheSinceIdAscendingAtMostAPage() {
    assertEquals((1L..200L).map { "$it" }, rows(many, SqlItemStore.NEXUS_ASK_IDS_SQL, 0, 0, NexusShares.PAGE).map { it.single() })
    assertEquals((201L..250L).map { "$it" }, rows(many, SqlItemStore.NEXUS_ASK_IDS_SQL, 200, 0, NexusShares.PAGE).map { it.single() })
    assertEquals(emptyList<List<String>>(), rows(many, SqlItemStore.NEXUS_ASK_IDS_SQL, 250, 0, NexusShares.PAGE))
    assertEquals(listOf("6", "7", "8"), rows(many, SqlItemStore.NEXUS_ASK_ITEMS_SQL, 5, 0, 3).map { it[0] })
  }

  @Test fun longTextIsCutInTheQuery() {
    val long = item(1, sms, "x", sms = true) + "UPDATE items SET text = replace(hex(zeroblob(2500)), '0', 'a') WHERE id = 1;\n"
    assertEquals(NexusShares.MAX_TEXT, rows(long, SqlItemStore.NEXUS_ASK_ITEMS_SQL, 0, 0, 1).single()[3].length)
  }

  private val debitsSql = "SELECT t.id FROM txns t WHERE ${SqlLedgerStore.NEXUS_DEBITS_WHERE}"
  private val from = 1_000_000L

  private fun txn(id: Long, dir: String, at: Long, own: Int = 0) =
    "INSERT INTO txns(id, direction, amount_minor, currency, account, at, own) VALUES ($id, '$dir', 100, 'PKR', 'Meezan 1234', $at, $own);\n"

  @Test fun debitsAreMoneyOutNotOwnInsideTheWindowWithTheEdgeIncluded() {
    val setup = txn(1, "OUT", from + 10) + txn(2, "IN", from + 10) + txn(3, "OUT", from + 10, own = 1) + txn(4, "OUT", from) + txn(5, "OUT", from - 1)
    assertEquals(listOf("1", "4"), rows(setup, debitsSql, 0, from, NexusShares.PAGE).map { it.single() })
  }

  @Test fun onlyTheNewest500DebitsCanEverBePagedThrough() {
    val setup = "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 600) " +
      "INSERT INTO txns(id, direction, amount_minor, currency, account, at) SELECT x, 'OUT', 100, 'PKR', 'Meezan', $from + x FROM n;\n"
    val pages = generateSequence(0L to rows(setup, debitsSql, 0, from, NexusShares.PAGE).map { it.single().toLong() }) { (_, page) ->
      page.lastOrNull()?.let { last -> last to rows(setup, debitsSql, last, from, NexusShares.PAGE).map { it.single().toLong() } }
    }.map { it.second }.toList()
    assertEquals(listOf(200, 200, 100, 0), pages.map { it.size })
    assertEquals((101L..600L).toList(), pages.flatten())
  }
}
