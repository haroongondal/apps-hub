package expo.modules.audiochunks.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.Random

class ShareRulesTest {
  private fun bytes(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }
  private fun ascii(s: String, pad: Int = 16) = (s + "\u0000".repeat(pad)).toByteArray(Charsets.ISO_8859_1)
  private fun ftyp(brand: String) = bytes(0, 0, 0, 0x20) + ascii("ftyp$brand")

  @Test
  fun sniffsEveryKindNexusKnows() {
    assertEquals("pdf", ShareRules.sniff(ascii("%PDF-1.7\n")))
    assertEquals("jpeg", ShareRules.sniff(bytes(0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10)))
    assertEquals("png", ShareRules.sniff(bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0)))
    assertEquals("webp", ShareRules.sniff(ascii("RIFF\u0010\u0000\u0000\u0000WEBPVP8 ")))
    assertEquals("wav", ShareRules.sniff(ascii("RIFF\u0010\u0000\u0000\u0000WAVEfmt ")))
    assertEquals("gif", ShareRules.sniff(ascii("GIF89a")))
    assertEquals("ogg", ShareRules.sniff(ascii("OggS\u0000\u0002")))
    assertEquals("flac", ShareRules.sniff(ascii("fLaC")))
    assertEquals("amr", ShareRules.sniff(ascii("#!AMR\n")))
    assertEquals("webm", ShareRules.sniff(bytes(0x1A, 0x45, 0xDF, 0xA3, 0x9F)))
    assertEquals("mp3", ShareRules.sniff(ascii("ID3\u0004")))
    assertEquals("mp3", ShareRules.sniff(bytes(0xFF, 0xFB, 0x90, 0x64)))
    assertEquals("mp3", ShareRules.sniff(bytes(0xFF, 0xF3, 0x48, 0xC4)))
    assertEquals("aac", ShareRules.sniff(bytes(0xFF, 0xF1, 0x50, 0x80)))
    assertEquals("aac", ShareRules.sniff(bytes(0xFF, 0xF9, 0x50, 0x80)))
  }

  @Test
  fun readsTheMp4Brand() {
    assertEquals("mp4", ShareRules.sniff(ftyp("M4A ")))
    assertEquals("mp4", ShareRules.sniff(ftyp("isom")))
    assertEquals("mp4", ShareRules.sniff(ftyp("mp42")))
    assertEquals("3gp", ShareRules.sniff(ftyp("3gp4")))
    assertEquals("3gp", ShareRules.sniff(ftyp("3g2a")))
    assertEquals("heic", ShareRules.sniff(ftyp("heic")))
    assertEquals("heic", ShareRules.sniff(ftyp("mif1")))
    assertEquals("unknown", ShareRules.sniff(ftyp("qt  ")))
    assertEquals("unknown", ShareRules.sniff(ftyp("avif")))
  }

  @Test
  fun anythingElseIsUnknown() {
    assertEquals("unknown", ShareRules.sniff(ascii("<!DOCTYPE html><html>")))
    assertEquals("unknown", ShareRules.sniff(ascii("MZ\u0090\u0000")))
    assertEquals("unknown", ShareRules.sniff(ascii("PK\u0003\u0004")))
    assertEquals("unknown", ShareRules.sniff(ByteArray(0)))
    assertEquals("unknown", ShareRules.sniff(ascii("%PD", 0)))
    assertEquals("unknown", ShareRules.sniff(bytes(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70)))
  }

  @Test
  fun keepsOnlyTheNameAsText() {
    assertEquals("x", ShareRules.displayName("../../x"))
    assertEquals("evil.pdf", ShareRules.displayName("..\\..\\evil.pdf"))
    assertEquals("Shared file", ShareRules.displayName(".."))
    assertEquals("Shared file", ShareRules.displayName(null))
    assertEquals("abc.pdf", ShareRules.displayName("a\u0000b\nc.pdf"))
    assertEquals("invoicefdp.exe", ShareRules.displayName("invoice‮fdp.exe"))
    assertEquals("تقرير.pdf", ShareRules.displayName("تقرير.pdf"))
    assertEquals("notes", ShareRules.displayName("notes"))
    val long = ShareRules.displayName("😀".repeat(200))
    assertEquals(120, long.codePointCount(0, long.length))
  }

  @Test
  fun acceptsContentUrisOnly() {
    assertTrue(ShareRules.allowedScheme("content"))
    assertTrue(ShareRules.allowedScheme("CONTENT"))
    assertFalse(ShareRules.allowedScheme("file"))
    assertFalse(ShareRules.allowedScheme("http"))
    assertFalse(ShareRules.allowedScheme(null))
  }

  private val own = "com.haroon.pdfeditor.pdfscan.fileprovider"
  private val ownAuthorities = listOf(own, "com.haroon.pdfeditor.FileSystemFileProvider")
  private val ownDirs = listOf("/data/user/0/com.haroon.pdfeditor", "/data/data/com.haroon.pdfeditor/files", "/data/user_de/0/com.haroon.pdfeditor/")

  private fun allowed(
    authority: String?,
    host: String? = authority,
    scheme: String? = "content",
    resolved: String? = null,
    path: String? = null,
  ) = ShareRules.sourceAllowed(scheme, authority, host, ownAuthorities, "com.haroon.pdfeditor", resolved, path, ownDirs)

  @Test
  fun acceptsAnotherAppsProvider() {
    assertTrue(allowed("com.whatsapp.provider.media", resolved = "com.whatsapp"))
    assertTrue(allowed("media", resolved = "com.android.providers.media.module"))
  }

  @Test
  fun refusesNexussOwnProviders() {
    assertFalse(allowed(own))
    assertFalse(allowed("com.haroon.pdfeditor.FileSystemFileProvider"))
    assertFalse(allowed("COM.Haroon.PdfEditor.PdfScan.FileProvider"))
    assertFalse(allowed("some.alias", resolved = "com.haroon.pdfeditor"))
  }

  @Test
  fun refusesUserInfoUserIdAndPortForms() {
    assertFalse(allowed("evil@$own", host = own))
    assertFalse(allowed("0@$own", host = own))
    assertFalse(allowed("0@com.whatsapp.provider.media", host = "com.whatsapp.provider.media"))
    assertFalse(allowed("$own:80", host = own))
    assertFalse(allowed("com.whatsapp.provider.media:1", host = "com.whatsapp.provider.media"))
  }

  @Test
  fun refusesMissingAuthorityEmptyHostAndOtherSchemes() {
    assertFalse(allowed(null))
    assertFalse(allowed(""))
    assertFalse(allowed("media", host = ""))
    assertFalse(allowed("media", host = null))
    assertFalse(allowed("media", scheme = "file"))
    assertFalse(allowed("", scheme = "file", path = "/sdcard/x.pdf"))
  }

  @Test
  fun refusesADescriptorInNexussOwnStorage() {
    assertFalse(allowed("media", path = "/data/user/0/com.haroon.pdfeditor/databases/library.db"))
    assertFalse(allowed("media", path = "/data/data/com.haroon.pdfeditor/files/library/abc/audio.m4a"))
    assertFalse(allowed("media", path = "/data/user/0/com.haroon.pdfeditor"))
    assertFalse(allowed("media", path = "/data/user_de/0/com.haroon.pdfeditor/shared_prefs/x.xml"))
    assertFalse(allowed("media", path = "/storage/emulated/0/../../../data/user/0/com.haroon.pdfeditor/shared_prefs/keys.xml"))
    // A symlink already resolved by the kernel, so the canonical string is what arrives.
    assertFalse(allowed("media", path = "/data/data/com.haroon.pdfeditor/files/shared-inbox/x/0"))
  }

  @Test
  fun acceptsADescriptorOutsideNexussStorage() {
    assertTrue(allowed("media", path = "/storage/emulated/0/Download/report.pdf"))
    assertTrue(allowed("media", path = "/data/user/0/com.haroon.pdfeditorx/files/a"))
    assertTrue(allowed("media", path = "/data/data/com.haroon.pdfeditor/filesx/a"))
    assertTrue(allowed("media", path = "pipe:[48213]"))
    assertTrue(allowed("media", path = null))
    assertFalse(allowed(own, path = null))
  }

  @Test
  fun stopsCopyingPastTheCap() {
    val data = ByteArray(200_000) { it.toByte() }
    val out = ByteArrayOutputStream()
    assertEquals(200_000L, ShareRules.copyCapped(ByteArrayInputStream(data), out, 200_000))
    assertTrue(out.toByteArray().contentEquals(data))
    val over = ByteArrayOutputStream()
    assertEquals(-1L, ShareRules.copyCapped(ByteArrayInputStream(data), over, 199_999))
    assertTrue(over.size() <= 199_999)
    assertEquals(0L, ShareRules.copyCapped(ByteArrayInputStream(ByteArray(0)), ByteArrayOutputStream(), 10))
  }

  @Test
  fun inboxIdsCarryTheirTimeAndMatchTheAppsPattern() {
    val now = 1_795_000_000_000L
    val id = ShareRules.inboxId(now, Random(1))
    assertTrue(id, Regex("^[0-9a-z]{6,10}-[0-9a-z]{8}$").matches(id))
    assertEquals(now, id.substringBefore('-').toLong(36))
  }

  @Test
  fun truncatesLongTextOnly() {
    assertEquals("abc", ShareRules.truncate("abcdef", 3))
    assertEquals("ab", ShareRules.truncate("ab", 3))
    assertEquals(null, ShareRules.truncate(null, 3))
  }
}
