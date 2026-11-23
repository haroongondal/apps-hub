package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class JournalTest {
  private val now = 1_800_000_000_000L
  private val ok = mapOf<String, Any?>("at" to (now - 1000).toDouble(), "mood" to 4.0, "tags" to listOf("tired", "headache"), "note" to "  Slept late  ")

  private fun problem(change: Pair<String, Any?>) = Journal.fromMap(ok + change, now).exceptionOrNull()?.message

  @Test fun aValidEntryIsTrimmedAndTagsFollowTheListOrder() {
    val e = Journal.fromMap(ok, now).getOrThrow()
    assertEquals(JournalEntry(0, now - 1000, 4, listOf("headache", "tired"), "Slept late"), e)
  }

  @Test fun moodIsRequiredFrom1To5() {
    assertEquals("Pick a mood from 1 to 5.", problem("mood" to null))
    assertEquals("Pick a mood from 1 to 5.", problem("mood" to 0.0))
    assertEquals("Pick a mood from 1 to 5.", problem("mood" to 6.0))
    assertEquals("Pick a mood from 1 to 5.", problem("mood" to 2.5))
    assertNull(problem("mood" to 1.0))
    assertNull(problem("mood" to 5.0))
  }

  @Test fun onlyTheFixedTags() {
    assertEquals("Pick tags from the list.", problem("tags" to listOf("fever")))
    assertEquals("Pick tags from the list.", problem("tags" to listOf("Headache")))
    assertEquals(Journal.TAGS, Journal.fromMap(ok + ("tags" to Journal.TAGS.reversed() + "pain"), now).getOrThrow().tags)
    assertEquals(emptyList<String>(), Journal.fromMap(ok + ("tags" to null), now).getOrThrow().tags)
  }

  @Test fun theNoteIsAtMost2000Characters() {
    assertNull(problem("note" to "a".repeat(2000)))
    assertEquals("Keep the note to 2000 characters or fewer.", problem("note" to "a".repeat(2001)))
    assertNull(problem("note" to "😀".repeat(2000)))
    assertNull(problem("note" to ""))
  }

  @Test fun theTimeIsRequiredAndNotInTheFuture() {
    assertEquals("Pick when this happened.", problem("at" to null))
    assertEquals("Pick a time that isn't in the future.", problem("at" to (now + 61_000).toDouble()))
    assertNull(problem("at" to (now + 60_000).toDouble()))
  }

  @Test fun saveCreatesUpdatesAndPagesNewestFirst() {
    val s = MemoryJournalStore()
    assertNull(Journal.save(s, ok, now))
    assertNull(Journal.save(s, ok + ("at" to (now - 500).toDouble()), now))
    assertNull(Journal.save(s, ok + ("id" to 1.0) + ("mood" to 2.0), now))
    assertEquals(2, s.rows[1]!!.mood)
    assertEquals(Journal.GONE, Journal.save(s, ok + ("id" to 9.0), now))
    assertEquals(listOf(2L, 1L), Journal.list(s, null, 10).map { it.id })
    assertEquals(listOf(1L), Journal.list(s, now - 500, 10).map { it.id })
    s.delete(1)
    assertEquals(listOf(2L), Journal.list(s, null, 10).map { it.id })
  }
}
