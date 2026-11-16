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
    override fun has(sha: String) = rows.any { it.sha == sha }
    override fun insert(itemId: Long, kind: String, mime: String, size: Long, file: String, sha: String, at: Long): Boolean {
      if (has(sha)) return false
      rows += MediaRow(next++, itemId, kind, mime, size, file, sha)
      return true
    }
    override fun get(mediaId: Long) = rows.firstOrNull { it.id == mediaId }
    override fun forItem(itemId: Long) = rows.filter { it.itemId == itemId }
    override fun removeForItem(itemId: Long): List<String> = rows.filter { it.itemId == itemId }.also { rows.removeAll(it) }.map { it.file }
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

  @Test fun sameBytesAreStoredOnce() {
    assertTrue(store.save(1, RawMedia("image/jpeg", photo), 1L))
    assertFalse(store.save(2, RawMedia("image/jpeg", photo), 2L))
    assertEquals(1, index.rows.size)
    assertEquals(1, File(dir, "media").list()!!.size)
  }

  @Test fun tooBigIsRefusedAndCounted() {
    assertFalse(store.save(1, RawMedia("video/mp4", ByteArray(MediaStore.MAX_BYTES + 1)), 1L))
    assertTrue(index.rows.isEmpty())
    assertEquals(1L, counters["mediaTooBig"])
    assertTrue(store.save(2, RawMedia("video/mp4", ByteArray(MediaStore.MAX_BYTES)), 1L))
  }

  @Test fun fileIsRemovedWithItsItem() {
    store.save(1, RawMedia("image/jpeg", photo), 1L)
    store.save(2, RawMedia("audio/ogg", "voice".toByteArray()), 2L)
    store.removeItem(1)
    assertEquals(listOf(2L), index.rows.map { it.itemId })
    assertEquals(listOf(index.rows.single().file), File(dir, "media").list()!!.toList())
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
