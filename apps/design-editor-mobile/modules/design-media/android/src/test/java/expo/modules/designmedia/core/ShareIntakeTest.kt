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
  fun theSameShareRebuiltAfterTheAppWasKilledIsNotTakenTwice() {
    val now = 10_000_000_000_000L
    val uris = listOf("content://media/external/images/media/1", "content://media/external/images/media/2")
    val record = shareRecord(uris, now)
    assertTrue(alreadyTaken(record, uris, now + 60_000))
    assertFalse(alreadyTaken(record, uris.reversed(), now + 60_000))
    assertFalse(alreadyTaken(record, uris.take(1), now + 60_000))
    assertFalse(alreadyTaken(record, uris, now + SHARE_REPEAT_MS + 1))
    assertFalse(alreadyTaken(record, uris, now - 1))
    assertFalse(alreadyTaken(null, uris, now))
    assertFalse(alreadyTaken("garbage", uris, now))
  }

  @Test
  fun aLocalPictureIsRecognisedByItsEnding() {
    assertTrue(isPictureName("Holiday.JPG"))
    assertTrue(isPictureName("a.b.png"))
    assertFalse(isPictureName("clip.mp4"))
    assertFalse(isPictureName("png"))
  }

  private val own = setOf("com.haroon.designeditor.FileSystemFileProvider", "com.haroon.designeditor.fileprovider")
  private val ownPackage = "com.haroon.designeditor"
  private fun isOwn(a: String) = isOwnAuthority(a, own, { if (it == "sneaky.alias") ownPackage else null }, ownPackage)

  @Test
  fun aForeignAuthorityIsAccepted() {
    val r = acceptShareUris(listOf("content://com.google.android.apps.photos.contentprovider/0/1/mediakey%3A%2F1/ORIGINAL/NONE/1", "content://media/external/images/media/9"), isOwn = ::isOwn)
    assertEquals(2, r.keep.size)
    assertEquals(0, r.blocked)
  }

  @Test
  fun ourOwnProvidersAreRefusedWhateverTheCase() {
    val uris = listOf(
      "content://com.haroon.designeditor.FileSystemFileProvider/expo_files/databases/x",
      "content://COM.HAROON.DESIGNEDITOR.filesystemfileprovider/cached_expo_files/a.jpg",
      "CONTENT://com.haroon.designeditor.fileprovider/shared/a",
      "content://sneaky.alias/x",
    )
    val r = acceptShareUris(uris, isOwn = ::isOwn)
    assertEquals(emptyList<String>(), r.keep)
    assertEquals(4, r.blocked)
  }

  @Test
  fun userInfoPortAndEncodedFormsOfAnAuthorityAreRefused() {
    listOf(
      "content://evil@com.haroon.designeditor.FileSystemFileProvider/expo_files/x",
      "content://0@com.haroon.designeditor.fileprovider/x",
      "content://media:80/x",
      "content://com.haroon.designeditor.fileprovider%2F/x",
      "content://com.haroon.designeditor%2Efileprovider/x",
      "content://own.authority\\x/y",
      "content://a b/x",
    ).forEach { assertEquals(it, null, contentAuthority(it)) }
  }

  @Test
  fun aMissingAuthorityIsRefused() {
    assertEquals(null, contentAuthority("content:///expo_files/x"))
    assertEquals(null, contentAuthority("content://"))
    assertEquals(null, contentAuthority("content://?q=1"))
    assertEquals(0, acceptShareUris(listOf("content:///x", "content://")).keep.size)
  }

  @Test
  fun fileAndOtherSchemesAreRefused() {
    val r = acceptShareUris(listOf("file:///data/user/0/com.haroon.designeditor/files/x", "http://a/b", "android.resource://x/1", "/data/x"))
    assertEquals(0, r.keep.size)
    assertEquals(4, r.blocked)
  }

  @Test
  fun theAuthorityIsReadUpToThePathQueryOrFragment() {
    assertEquals("media", contentAuthority("content://Media/x"))
    assertEquals("media", contentAuthority("content://media?x=1"))
    assertEquals("media", contentAuthority("content://media#f"))
  }

  @Test
  fun aStreamWhoseRealPathIsInsideTheAppsPrivateFoldersIsRefused() {
    val dirs = listOf("/data/user/0/com.haroon.designeditor", "/data/data/com.haroon.designeditor", "/storage/emulated/0/Android/data/com.haroon.designeditor/files")
    assertTrue(insidePrivateDirs("/data/user/0/com.haroon.designeditor/databases/vault.db", dirs))
    assertTrue(insidePrivateDirs("/data/data/com.haroon.designeditor/shared_prefs/a.xml", dirs))
    assertTrue(insidePrivateDirs("/data/user/0/com.haroon.designeditor/files/../no_backup/k", dirs))
    assertTrue(insidePrivateDirs("/storage/emulated/0/Android/data/com.haroon.designeditor/files/a.jpg", dirs))
    assertFalse(insidePrivateDirs("/storage/emulated/0/DCIM/Camera/a.jpg", dirs))
    assertFalse(insidePrivateDirs("/data/user/0/com.haroon.designeditor2/files/a", dirs))
    assertFalse(insidePrivateDirs("/data/user/0/com.other/files/../../com.haroon.designeditorx/a", dirs))
    assertFalse(insidePrivateDirs("/data/user/0/com.haroon.designeditor/../com.other/files/a", dirs))
  }
}
