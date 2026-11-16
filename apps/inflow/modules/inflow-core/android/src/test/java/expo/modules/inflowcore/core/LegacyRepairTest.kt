package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LegacyRepairTest {
  private val wa = "com.whatsapp"
  private val min = 60_000L
  private val t0 = 1_700_000_000_000L
  private var nextId = 1L

  private fun thread(name: String) = name to senderKey(wa, name)

  private fun row(sender: String, text: String, at: Long, inThread: String, captured: Long = at, pkg: String = wa) =
    LegacyRow(nextId++, pkg, sender, senderKey(pkg, inThread), inThread, inThread, text, at, captured)

  @Test fun youThreadCopyWithATwinIsDeleted() {
    val good = row("Sunflower", "Call me", t0, "Sunflower")
    val copy = row("Sunflower", "Call me", t0, "You")
    assertEquals(listOf(LegacyAction.Delete(copy.id)), LegacyRepair.plan(listOf(good, copy)))
  }

  @Test fun copyWithoutATwinIsMovedWithARecomputedHash() {
    val copy = row("Sunflower", "Call me", t0, "You")
    val move = LegacyRepair.plan(listOf(copy)).single() as LegacyAction.Move
    val (name, key) = thread("Sunflower")
    assertEquals(copy.id, move.id)
    assertEquals(name, move.conversation)
    assertEquals(key, move.conversationKey)
    assertEquals(NotificationParser.messageHash(wa, key, "Sunflower", t0, "Call me"), move.hash)
    assertTrue("sunflower" in move.search && "call me" in move.search)
  }

  @Test fun twoCopiesOfOneMessageKeepExactlyOne() {
    val a = row("Sunflower", "Call me", t0, "You")
    val b = row("Sunflower", "Call me", t0, "You")
    val plan = LegacyRepair.plan(listOf(a, b))
    assertEquals(listOf(a.id), plan.filterIsInstance<LegacyAction.Move>().map { it.id })
    assertEquals(listOf(b.id), plan.filterIsInstance<LegacyAction.Delete>().map { it.id })
  }

  @Test fun sameTextAtAnotherTimeIsNotATwin() {
    val good = row("Sunflower", "ok", t0, "Sunflower")
    val copy = row("Sunflower", "ok", t0 + min, "You")
    assertTrue(LegacyRepair.plan(listOf(good, copy)).single() is LegacyAction.Move)
  }

  @Test fun ownMessageMovesNextToTheNearestOtherSenderItem() {
    val moon = row("Moon", "Hi", t0, "Moon")
    val sun = row("Sunflower", "Call me", t0 + 10 * min, "Sunflower")
    val mine = row("You", "On my way", t0 + 11 * min, "You")
    val move = LegacyRepair.plan(listOf(moon, sun, mine)).single() as LegacyAction.Move
    assertEquals(mine.id, move.id)
    assertEquals("Sunflower", move.conversation)
    assertEquals(senderKey(wa, "Sunflower"), move.conversationKey)
    assertEquals(NotificationParser.messageHash(wa, senderKey(wa, "Sunflower"), "You", t0 + 11 * min, "On my way"), move.hash)
  }

  @Test fun ownMessageFollowsAContactCopyThatMovesToo() {
    val copy = row("Sunflower", "Call me", t0, "You")
    val mine = row("You", "On my way", t0 + min, "You")
    val plan = LegacyRepair.plan(listOf(copy, mine)).filterIsInstance<LegacyAction.Move>()
    assertEquals(listOf("Sunflower", "Sunflower"), plan.map { it.conversation })
  }

  @Test fun ownMessageWithNoOtherSenderWithinFiveMinutesStays() {
    val sun = row("Sunflower", "Call me", t0, "Sunflower")
    val mine = row("You", "On my way", t0 + 6 * min, "You")
    assertTrue(LegacyRepair.plan(listOf(sun, mine)).isEmpty())
  }

  @Test fun nothingElseChangesAndTextIsPreserved() {
    val rows = listOf(
      row("Sunflower", "a", t0, "Sunflower"), row("Moon", "b", t0, "Moon"), row("Ammi", "c", t0, "Family"),
      row("Dave", "x", t0, "You", pkg = "com.example"), row("You", "mine", t0, "Sunflower"),
      row("Sunflower", "a", t0, "You"), row("Sunflower", "d", t0 + min, "You"), row("You", "reply", t0 + 2 * min, "You"),
    )
    val plan = LegacyRepair.plan(rows)
    val touched = plan.map { (it as? LegacyAction.Move)?.id ?: (it as LegacyAction.Delete).id }.toSet()
    assertEquals(setOf(rows[5].id, rows[6].id, rows[7].id), touched)
    // Only the identical copy of "a" is deleted: 8 rows -> 7 texts remain.
    assertEquals(listOf(rows[5].id), plan.filterIsInstance<LegacyAction.Delete>().map { it.id })
  }

  @Test fun otherAppsAndEmptyInputAreLeftAlone() {
    assertTrue(LegacyRepair.plan(emptyList()).isEmpty())
    assertTrue(LegacyRepair.plan(listOf(row("Dave", "x", t0, "You", pkg = "com.example"))).isEmpty())
  }
}
