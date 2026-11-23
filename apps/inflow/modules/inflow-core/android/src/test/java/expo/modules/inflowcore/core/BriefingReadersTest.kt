package expo.modules.inflowcore.core

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BriefingReadersTest {
  private val today = LocalDate.parse("2026-11-24")
  private val home = LinkTable(listOf("person", "present", "last_seen_at"), listOf(listOf("Ali", 1L, 5L), listOf("Sara", 1L, 6L), listOf("Omar", 0L, 7L)))
  private val cards = LinkTable(
    listOf("kind", "label", "expires_on", "days_left"),
    listOf(listOf("card", "CANARY-CARD", "2026-11-30", 6L), listOf("card", "Card", "2026-12-31", 37L), listOf("pass", "Card", "2026-11-30", 6L), listOf("card", "Card", "2026-10-31", -24L)),
  )
  private val tasks = LinkTable(
    listOf("id", "label", "due_at", "state"),
    listOf(listOf(1L, "CANARY-TASK", 9L, "waiting_for_ok"), listOf(2L, "Draft from shared text", null, "draft"), listOf(3L, "Water", 99L, "scheduled")),
  )
  private val nexus = LinkTable(listOf("id", "title", "due_at"), listOf(listOf(1L, "CANARY-TITLE", null), listOf(2L, "Call the bank", 5L), listOf(3L, "Pay rent", null)))

  private fun resolver(vararg answers: Pair<String, () -> LinkTable?>): Pair<LinkResolver, MutableList<String>> {
    val asked = java.util.Collections.synchronizedList(mutableListOf<String>())
    val map = answers.toMap()
    return LinkResolver { uri -> asked += uri; map[uri]?.invoke() } to asked
  }

  private val all = arrayOf(
    BriefingReaders.HOME_URI to { home }, BriefingReaders.CARDS_URI to { cards },
    BriefingReaders.TASKS_URI to { tasks }, BriefingReaders.NEXUS_URI to { nexus },
  )

  private val trustAll = ProviderTrust { _, _ -> true }

  private fun read(r: LinkResolver, timeoutMs: Long = BriefingReaders.TIMEOUT_MS, trust: ProviderTrust = trustAll) =
    BriefingReaders.lines(r, trust, today, timeoutMs)

  @Test fun aProviderThatFailsTheIdentityCheckIsNeverQueriedAndGivesNoLine() {
    val (r, asked) = resolver(*all)
    val checked = java.util.Collections.synchronizedList(mutableListOf<Pair<String, String>>())
    assertEquals(emptyList<AppLine>(), read(r, trust = { a, p -> checked += a to p; false }))
    assertEquals(emptyList<String>(), asked.toList())
    // Each reader asks about its own sibling's authority and package.
    assertEquals(
      setOf(
        "com.haroon.netlens.applink" to "app.netlens", "com.haroon.strongroom.applink" to "com.haroon.strongroom",
        "com.haroon.deputy.applink" to "com.haroon.deputy", "com.haroon.pdfeditor.applink" to "com.haroon.pdfeditor",
      ),
      checked.toSet(),
    )
    // A check that throws counts as untrusted.
    assertEquals(emptyList<AppLine>(), read(r, trust = { _, _ -> throw IllegalStateException("package manager died") }))
    assertEquals(emptyList<String>(), asked.toList())
    // Only the one that passes is read.
    assertEquals(listOf(AppLine(BriefingKind.TASKS, "2 tasks are waiting for you")), read(r, trust = { _, p -> p == "com.haroon.deputy" }))
    assertEquals(listOf(BriefingReaders.TASKS_URI), asked.toList())
  }

  @Test fun eachShareGivesOneSummaryLineBuiltByInflow() {
    val (r, asked) = resolver(*all)
    val lines = read(r)
    assertEquals(
      listOf(
        AppLine(BriefingKind.HOME, "Ali and Sara are home"), AppLine(BriefingKind.CARDS, "1 card expires this month"),
        AppLine(BriefingKind.TASKS, "2 tasks are waiting for you"), AppLine(BriefingKind.NEXUS, "3 things in Nexus today"),
      ),
      lines,
    )
    assertEquals(setOf(BriefingReaders.HOME_URI, BriefingReaders.CARDS_URI, BriefingReaders.TASKS_URI, BriefingReaders.NEXUS_URI), asked.toSet())
    assertTrue(lines.none { it.text.contains("CANARY") || it.text.contains("Water") || it.text.contains("rent") })
  }

  @Test fun aRefusalAnErrorANullCursorOrNoProviderIsNoLineAndTheOthersStillCome() {
    val (r, _) = resolver(
      BriefingReaders.HOME_URI to { throw SecurityException("Not a signed sibling app") },
      BriefingReaders.CARDS_URI to { throw IllegalStateException("boom") },
      BriefingReaders.TASKS_URI to { null },
      BriefingReaders.NEXUS_URI to { nexus },
    )
    assertEquals(listOf(AppLine(BriefingKind.NEXUS, "3 things in Nexus today")), read(r))
    assertEquals(emptyList<AppLine>(), read(resolver().first))
  }

  @Test fun aSlowProviderIsDroppedAfterTheTimeout() {
    val (r, _) = resolver(BriefingReaders.HOME_URI to { Thread.sleep(10_000); home }, BriefingReaders.TASKS_URI to { tasks })
    val started = System.nanoTime()
    val lines = read(r, timeoutMs = 300)
    assertTrue((System.nanoTime() - started) / 1_000_000 < 3_000)
    assertEquals(listOf(AppLine(BriefingKind.TASKS, "2 tasks are waiting for you")), lines)
  }

  @Test fun aMissingColumnIsNoLine() {
    val noState = LinkTable(listOf("id", "label", "due_at"), listOf(listOf(1L, "x", null)))
    val noSeen = LinkTable(listOf("person", "present"), listOf(listOf("Ali", 1L)))
    val plannedNexusWithout = LinkTable(listOf("id", "name"), listOf(listOf(1L, "x")))
    val (r, _) = resolver(BriefingReaders.HOME_URI to { noSeen }, BriefingReaders.TASKS_URI to { noState }, BriefingReaders.NEXUS_URI to { plannedNexusWithout })
    assertEquals(emptyList<AppLine>(), read(r))
  }

  @Test fun badRowsAreDroppedAndGoodOnesKept() {
    val bad = LinkTable(
      listOf("person", "present", "last_seen_at"),
      listOf(
        listOf("Ali", "1", 5L),                 // present as text
        listOf(null, 1L, 5L),                   // no name
        listOf("   ", 1L, 5L),                  // blank name
        listOf("Sara", 1L),                     // short row
        listOf("Omar", 1L, 5L, "extra"),        // long row
        listOf("Zed", 1.0, 5L),                 // present as a double
        listOf("Bilal\n\u0000Khan", 1L, 5L),    // control characters removed
        listOf("Nadia", 1L, -1L),               // impossible last seen
      ),
    )
    assertEquals(listOf(AppLine(BriefingKind.HOME, "Bilal Khan is home")), read(resolver(BriefingReaders.HOME_URI to { bad }).first))
    val tasksBad = LinkTable(listOf("id", "label", "due_at", "state"), listOf(listOf("1", "x", null, "draft"), listOf(2L, "x", "soon", "draft"), listOf(3L, "x", null, "draft")))
    assertEquals(listOf(AppLine(BriefingKind.TASKS, "1 task is waiting for you")), read(resolver(BriefingReaders.TASKS_URI to { tasksBad }).first))
  }

  @Test fun columnsAreFoundByNameInAnyOrder() {
    val shuffled = LinkTable(listOf("last_seen_at", "person", "present"), listOf(listOf(5L, "Ali", 1L)))
    assertEquals(listOf(AppLine(BriefingKind.HOME, "Ali is home")), read(resolver(BriefingReaders.HOME_URI to { shuffled }).first))
  }

  @Test fun homeNamesUpToThreeThenCountsAndCapsEachName() {
    fun rows(vararg names: String) = names.map { mapOf<String, Any?>("person" to it, "present" to 1L, "last_seen_at" to 1L) }
    assertEquals("Ali, Sara and Omar are home", BriefingReaders.home(rows("Ali", "Sara", "Omar"))?.text)
    assertEquals("4 people are home", BriefingReaders.home(rows("Ali", "Sara", "Omar", "Zed"))?.text)
    assertEquals("A".repeat(12) + " is home", BriefingReaders.home(rows("A".repeat(60)))?.text)
    assertEquals(null, BriefingReaders.home(emptyList()))
  }

  @Test fun countsAreZeroAsNoLine() {
    assertEquals(null, BriefingReaders.cards(emptyList(), today))
    assertEquals(null, BriefingReaders.tasks(listOf(mapOf("state" to "scheduled"))))
    assertEquals(null, BriefingReaders.nexus(emptyList()))
  }

  @Test fun onlyTheShareRowCapIsRead() {
    val many = LinkTable(listOf("person", "present", "last_seen_at"), (1..40).map { listOf("P$it", if (it > 16) 1L else 0L, 1L) })
    assertEquals(emptyList<AppLine>(), read(resolver(BriefingReaders.HOME_URI to { many }).first))
  }
}
