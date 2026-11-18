package expo.modules.inflowcore.android

import expo.modules.inflowcore.core.RawMedia
import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class MediaStoreTest {
  private class FakeIndex : MediaIndex {
    val rows = mutableListOf<MediaRow>()
    private var next = 1L
    override fun has(itemId: Long, sha: String) = rows.any { it.itemId == itemId && it.sha == sha }
    override fun insert(itemId: Long, kind: String, mime: String, size: Long, file: String, sha: String, at: Long): Boolean {
      if (has(itemId, sha)) return false
      rows += MediaRow(next++, itemId, kind, mime, size, file, sha)
      return true
    }
    override fun get(mediaId: Long) = rows.firstOrNull { it.id == mediaId }
    override fun forItem(itemId: Long) = rows.filter { it.itemId == itemId }
  }

  private lateinit var dir: File
  private val index = FakeIndex()
  private val counters = HashMap<String, Long>()
  private val dbKey = ByteArray(32) { it.toByte() }   // a fake database key
  private lateinit var store: MediaStore
  private val photo = "photo bytes ".repeat(50).toByteArray()

  @Before fun setUp() {
    dir = Files.createTempDirectory("media-test").toFile()
    store = MediaStore(File(dir, "media"), MediaStore.keyFor(dbKey), index) { k, n -> counters.merge(k, n, Long::plus) }
  }

  @Test fun roundTrip() {
    assertTrue(store.save(7, RawMedia("image/jpeg", photo), 1_000L))
    val row = index.forItem(7).single()
    assertEquals("image", row.kind)
    assertEquals(photo.size.toLong(), row.size)
    assertArrayEquals(photo, store.read(row.id))
    assertEquals(1L, counters["mediaSaved"])
    assertEquals(photo.size.toLong(), counters["mediaBytes"])
  }

  @Test fun fileOnDiskIsCiphertext() {
    store.save(7, RawMedia("image/jpeg", photo), 1_000L)
    val bytes = File(File(dir, "media"), index.rows.single().file).readBytes()
    assertEquals(12 + photo.size + 16, bytes.size)   // IV + ciphertext + GCM tag
    assertNotEquals(photo.toList(), bytes.drop(12).take(photo.size))
    assertFalse(String(bytes, Charsets.ISO_8859_1).contains("photo bytes"))
  }

  @Test fun anotherKeyCannotRead() {
    store.save(7, RawMedia("image/jpeg", photo), 1_000L)
    val other = MediaStore(File(dir, "media"), MediaStore.keyFor(ByteArray(32) { 9 }), index)
    assertNull(other.read(index.rows.single().id))
  }

  @Test fun sameBytesTwiceForOneItemAreStoredOnce() {
    assertTrue(store.save(1, RawMedia("image/jpeg", photo), 1L))
    assertFalse(store.save(1, RawMedia("image/jpeg", photo), 2L))
    assertEquals(1, index.rows.size)
    assertEquals(1, File(dir, "media").list()!!.size)
  }

  @Test fun sameBytesForTwoItemsGiveTwoRowsAndTwoFiles() {
    assertTrue(store.save(1, RawMedia("image/jpeg", photo), 1L))
    assertTrue(store.save(2, RawMedia("image/jpeg", photo), 2L))
    assertEquals(listOf(1L, 2L), index.rows.map { it.itemId })
    assertEquals(2, index.rows.map { it.file }.toSet().size)
    assertEquals(2, File(dir, "media").list()!!.size)
    assertArrayEquals(photo, store.read(index.forItem(2).single().id))
  }

  @Test fun forgettingOneItemsFilesLeavesTheOthers() {
    store.save(1, RawMedia("image/jpeg", photo), 1L)
    store.save(2, RawMedia("image/jpeg", photo), 2L)
    val gone = index.forItem(1).map { it.file }
    index.rows.removeAll { it.itemId == 1L }
    MediaStore.deleteFiles(File(dir, "media"), gone)
    assertEquals(listOf(index.rows.single().file), File(dir, "media").list()!!.toList())
    assertArrayEquals(photo, store.read(index.rows.single().id))
  }

  @Test fun tooBigIsRefusedAndCounted() {
    assertFalse(store.save(1, RawMedia("video/mp4", ByteArray(MediaStore.MAX_BYTES + 1)), 1L))
    assertTrue(index.rows.isEmpty())
    assertEquals(1L, counters["mediaTooBig"])
    assertTrue(store.save(2, RawMedia("video/mp4", ByteArray(MediaStore.MAX_BYTES)), 1L))
  }

  @Test fun forgettingMediaAlsoDeletesItsDecryptedCopy() {
    val open = File(dir, "open").apply { mkdirs() }
    val copy = File(open, "abc123.jpg").apply { writeBytes(byteArrayOf(1)) }
    val other = File(open, "abc1234.jpg").apply { writeBytes(byteArrayOf(1)) }   // another file whose name merely starts the same
    File(File(dir, "media").apply { mkdirs() }, "abc123").writeBytes(byteArrayOf(2))
    MediaStore.deleteFiles(File(dir, "media"), listOf("abc123"), open)
    assertFalse(copy.exists())
    assertTrue(other.exists())
    assertFalse(File(File(dir, "media"), "abc123").exists())
  }

  @Test fun clearOpenedRemovesCopiesOlderThanTheGrace() {
    val open = File(dir, "open").apply { mkdirs() }
    val old = File(open, "old.jpg").apply { writeBytes(byteArrayOf(1)); setLastModified(System.currentTimeMillis() - 120_000) }
    val fresh = File(open, "fresh.jpg").apply { writeBytes(byteArrayOf(1)) }
    MediaStore.clearOpened(open, olderThanMs = 30_000)
    assertFalse(old.exists())
    assertTrue(fresh.exists())
    MediaStore.clearOpened(open)
    assertFalse(fresh.exists())
  }

  @Test fun orphanFilesAreSwept() {
    store.save(1, RawMedia("image/jpeg", photo), 1L)
    val orphan = File(File(dir, "media"), "orphan").apply { writeBytes(byteArrayOf(1)) }
    MediaStore.sweep(File(dir, "media"), index.rows.map { it.file }.toSet(), olderThanMs = -1)
    assertFalse(orphan.exists())
    assertEquals(1, File(dir, "media").list()!!.size)
  }

  @Test fun kindsFollowTheMime() {
    store.save(1, RawMedia("image/webp", "s".toByteArray()), 1L)
    store.save(2, RawMedia("audio/ogg; codecs=opus", "a".toByteArray()), 1L)
    store.save(3, RawMedia("application/pdf", "d".toByteArray()), 1L)
    store.save(4, RawMedia("text/x-vcard", "c".toByteArray()), 1L)
    assertEquals(listOf("sticker", "audio", "document", "document"), index.rows.map { it.kind })
  }
}
