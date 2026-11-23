package expo.modules.designmedia.core

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareIntakeTest {
  @Test
  fun onlyContentAddressesAreKeptOnceEachAndAtMostTheCap() {
    val uris = listOf("content://a/1", "content://a/1", "file:///data/data/x/secret", "content://a/2", "content://a/3")
    val r = acceptShareUris(uris, max = 2)
    assertEquals(listOf("content://a/1", "content://a/2"), r.keep)
    assertEquals(1, r.overCap)
    assertEquals(1, r.blocked)
  }

  @Test
  fun twentyFiveStreamsKeepTwenty() {
    val r = acceptShareUris((1..25).map { "content://m/$it" })
    assertEquals(20, r.keep.size)
    assertEquals(5, r.overCap)
  }

  @Test
  fun aCopyUnderTheCapIsExact() {
    val data = ByteArray(200_000) { it.toByte() }
    val out = ByteArrayOutputStream()
    assertEquals(200_000L, copyCapped(ByteArrayInputStream(data), out, 200_000))
    assertArrayEquals(data, out.toByteArray())
  }

  @Test
  fun aCopyOverTheCapStopsAndSaysTooBig() {
    val out = ByteArrayOutputStream()
    val e = assertThrows(ShareTooBig::class.java) { copyCapped(ByteArrayInputStream(ByteArray(1000)), out, 999) }
    assertEquals("too_big", problemOf(e))
    assertTrue(out.size() <= 999)
  }

  @Test
  fun problemsAreNamedForThePlainMessages() {
    assertEquals("no_space", problemOf(IOException("write failed: ENOSPC (No space left on device)")))
    assertEquals("unreadable", problemOf(SecurityException("denied")))
    assertEquals("unreadable", problemOf(IOException("broken pipe")))
  }

  @Test
  fun theHeadIsTheFirstBytesAsUnsignedNumbers() {
    val file = File.createTempFile("share", ".part")
    try {
      file.writeBytes(byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 1, 2))
      assertEquals(listOf(255, 216, 255, 1, 2), headOf(file))
      assertEquals(listOf(255, 216), headOf(file, 2))
      file.writeBytes(ByteArray(0))
      assertEquals(emptyList<Int>(), headOf(file))
    } finally {
      file.delete()
    }
  }

  @Test
  fun aFileNeedsItsSizePlusAMarginFree() {
    assertTrue(fitsOnDisk(-1, 0))
    assertTrue(fitsOnDisk(100, 100 + SHARE_SPACE_MARGIN))
    assertFalse(fitsOnDisk(100, 100 + SHARE_SPACE_MARGIN - 1))
  }

  @Test
  fun onlyBatchesOlderThanAWeekExpireAndOtherFoldersAreLeftAlone() {
    val now = 10_000_000_000_000L
    val old = (now - SHARE_KEEP_MS - 1).toString()
    val fresh = (now - SHARE_KEEP_MS + 1).toString()
    assertEquals(listOf(old), expiredBatches(listOf(old, fresh, "notes", ""), now))
  }

  @Test
  fun aLocalPictureIsRecognisedByItsEnding() {
    assertTrue(isPictureName("Holiday.JPG"))
    assertTrue(isPictureName("a.b.png"))
    assertFalse(isPictureName("clip.mp4"))
    assertFalse(isPictureName("png"))
  }
}
