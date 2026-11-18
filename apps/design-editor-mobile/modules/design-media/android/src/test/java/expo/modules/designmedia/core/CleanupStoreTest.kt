package expo.modules.designmedia.core

import java.io.File
import java.io.IOException
import kotlin.io.path.createTempDirectory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CleanupStoreTest {
  private val day = 24L * 60 * 60 * 1000
  private val now = 100 * day

  private fun entry(uri: String, trashedAt: Long = now, bytes: Long = 10) = TrashEntry(uri, "$uri.jpg", bytes, trashedAt)

  private fun file(name: String = "t.json") = File(createTempDirectory().toFile(), name)

  @Test
  fun addThenAllRoundTrips() {
    val f = file()
    val a = entry("content://media/external/images/media/1", bytes = 5)
    val b = entry("content://media/external/images/media/2", trashedAt = now - day)
    TrashRecord(f).add(listOf(a, b))
    assertEquals(listOf(a, b), TrashRecord(f).all())
  }

  @Test
  fun missingOrCorruptFileIsEmpty() {
    assertEquals(emptyList<TrashEntry>(), TrashRecord(file()).all())
    assertEquals(emptySet<Pair<String, Long>>(), Dismissals(file()).all())
    for (garbage in listOf("", "{", "not json", "[1,2]", "{\"a\":1}", "[{\"uri\":\"x\"}]", "[{\"kind\":\"blurry\",\"id\":\"x\"}]")) {
      val f = file().also { it.writeText(garbage) }
      assertEquals(emptyList<TrashEntry>(), TrashRecord(f).all())
      assertEquals(emptySet<Pair<String, Long>>(), Dismissals(f).all())
    }
  }

  @Test
  fun recentKeepsThirtyDays() {
    val f = file()
    val fresh = entry("u29", now - 29 * day)
    val old = entry("u31", now - 31 * day)
    val record = TrashRecord(f)
    record.add(listOf(fresh, old))
    assertEquals(listOf(fresh), record.recent(now, setOf("u29", "u31")))
    assertEquals(listOf(fresh), TrashRecord(f).all())
  }

  @Test
  fun recentDropsNoLongerTrashed() {
    val f = file()
    val kept = entry("a")
    val gone = entry("b")
    val record = TrashRecord(f)
    record.add(listOf(kept, gone))
    assertEquals(listOf(kept), record.recent(now, setOf("a")))
    assertEquals(listOf(kept), TrashRecord(f).all())
  }

  @Test
  fun removeAfterRestore() {
    val f = file()
    val a = entry("a")
    val b = entry("b")
    val record = TrashRecord(f)
    record.add(listOf(a, b))
    record.remove(setOf("a", "nope"))
    assertEquals(listOf(b), TrashRecord(f).all())
  }

  @Test
  fun addSameUriTwiceKeepsNewest() {
    val record = TrashRecord(file())
    record.add(listOf(entry("a", trashedAt = now - day, bytes = 1)))
    record.add(listOf(entry("a", trashedAt = now, bytes = 2)))
    assertEquals(listOf(entry("a", trashedAt = now, bytes = 2)), record.all())
  }

  @Test
  fun namesWithQuotesAndUnicodeSurvive() {
    val f = file()
    val odd = TrashEntry("u", "\"q\" \\ اردو \n.jpg", 1, now)
    TrashRecord(f).add(listOf(odd))
    assertEquals(listOf(odd), TrashRecord(f).all())
  }

  @Test
  fun dismissalsRoundTripAndClear() {
    val f = file()
    val d = Dismissals(f)
    d.add("blurry", listOf(1L, 2L))
    d.add("blurry", listOf(2L))
    d.add("copies", listOf(1L))
    assertEquals(setOf("blurry" to 1L, "blurry" to 2L, "copies" to 1L), Dismissals(f).all())
    d.clear()
    assertTrue(Dismissals(f).all().isEmpty())
  }

  @Test
  fun sharedInstanceKeepsConcurrentAdds() {
    val t = file()
    val d = file("d.json")
    val threads = (0 until 2).map { n ->
      Thread {
        repeat(200) { i ->
          CleanupStores.record(t).add(listOf(entry("u$n-$i")))
          CleanupStores.dismissals(d).add("blurry", listOf(n * 1000L + i))
        }
      }
    }
    threads.forEach { it.start() }
    threads.forEach { it.join() }
    assertEquals(400, CleanupStores.record(t).all().size)
    assertEquals(400, CleanupStores.dismissals(d).all().size)
  }

  @Test
  fun unparseableFileIsKeptAsBad() {
    val f = file().also { it.writeText("not json") }
    val bad = File(f.parentFile, "t.json.bad")
    TrashRecord(f).add(listOf(entry("a")))
    assertEquals("not json", bad.readText())
    assertEquals(listOf(entry("a")), TrashRecord(f).all())
    f.writeText("{broken")
    TrashRecord(f).remove(setOf("a"))
    assertEquals("{broken", bad.readText()) // one .bad, the latest
    val d = file("d.json").also { it.writeText("[") }
    Dismissals(d).add("dark", listOf(1L))
    assertEquals("[", File(d.parentFile, "d.json.bad").readText())
    TrashRecord(file("ok.json")).add(listOf(entry("a")))
    assertFalse(File(f.parentFile, "ok.json.bad").exists())
  }

  @Test
  fun mediaStoreDropsEntriesOnlyWithFullAccess() {
    val f = file()
    val a = entry("a")
    val old = entry("old", now - 31 * day)
    TrashRecord(f).add(listOf(a, old))
    // Revoked or Selected-photos access answers with an empty cursor, not a failed one.
    assertEquals(listOf(a), recentEntries(TrashRecord(f), now, fullAccess = false, stillTrashed = emptySet()))
    assertEquals(listOf(a), recentEntries(TrashRecord(f), now, fullAccess = true, stillTrashed = null))
    assertEquals(listOf(a, old), TrashRecord(f).all())
    assertEquals(emptyList<TrashEntry>(), recentEntries(TrashRecord(f), now, fullAccess = true, stillTrashed = emptySet()))
    assertEquals(emptyList<TrashEntry>(), TrashRecord(f).all())
  }

  @Test
  fun undismissDropsOnlyThosePairs() {
    val f = file()
    val d = Dismissals(f)
    d.add("blurry", listOf(1L, 2L))
    d.add("copies", listOf(1L))
    d.remove("blurry", listOf(1L, 9L))
    assertEquals(setOf("blurry" to 2L, "copies" to 1L), Dismissals(f).all())
  }

  @Test
  fun aFailedWriteLeavesTheOldRecord() {
    val f = file()
    TrashRecord(f).add(listOf(entry("a")))
    val old = f.readText()
    val tmp = File(f.parentFile, "t.json.tmp").apply { mkdir() }
    assertThrows(IOException::class.java) { TrashRecord(f).add(listOf(entry("b"))) }
    assertEquals(old, f.readText())
    tmp.delete()
    TrashRecord(f).add(listOf(entry("b")))
    assertEquals(listOf(entry("a"), entry("b")), TrashRecord(f).all())
    assertFalse(tmp.exists())
  }
}
