package expo.modules.audiochunks.core

import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.Locale
import java.util.Random

object ShareRules {
  const val INBOX_DIR = "shared-inbox"
  const val MAX_ITEMS = 10
  const val MAX_ITEM_BYTES = 100L * 1024 * 1024
  const val MAX_SHARE_BYTES = 250L * 1024 * 1024
  const val MAX_TEXT = 100_000
  const val MAX_SUBJECT = 500
  const val HEAD_BYTES = 32
  private const val MAX_NAME = 120
  private val HEIF = setOf("heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1")

  fun sniff(b: ByteArray): String {
    fun u(i: Int) = if (i < b.size) b[i].toInt() and 0xFF else -1
    fun at(i: Int, s: String) = b.size >= i + s.length && s.indices.all { u(i + it) == s[it].code }
    return when {
      at(0, "%PDF-") -> "pdf"
      u(0) == 0xFF && u(1) == 0xD8 && u(2) == 0xFF -> "jpeg"
      at(0, "\u0089PNG\r\n\u001a\n") -> "png"
      at(0, "RIFF") && at(8, "WEBP") -> "webp"
      at(0, "RIFF") && at(8, "WAVE") -> "wav"
      at(0, "GIF8") -> "gif"
      at(0, "OggS") -> "ogg"
      at(0, "fLaC") -> "flac"
      at(0, "#!AMR") -> "amr"
      u(0) == 0x1A && u(1) == 0x45 && u(2) == 0xDF && u(3) == 0xA3 -> "webm"
      at(4, "ftyp") && b.size >= 12 -> brand(String(b, 8, 4, Charsets.ISO_8859_1))
      at(0, "ID3") -> "mp3"
      // Both start with a run of 1 bits; the two layer bits tell them apart: 00 is AAC in ADTS, 01 is MPEG Layer III.
      u(0) == 0xFF && (u(1) and 0xF6) == 0xF0 -> "aac"
      u(0) == 0xFF && (u(1) and 0xE6) == 0xE2 -> "mp3"
      else -> "unknown"
    }
  }

  private fun brand(major: String) = when {
    major.startsWith("3g") -> "3gp"
    major in HEIF -> "heic"
    major == "qt  " || major == "avif" || major == "crx " -> "unknown"
    else -> "mp4"
  }

  fun displayName(raw: String?): String {
    val base = (raw ?: "").substringAfterLast('/').substringAfterLast('\\')
      .filter { !Character.isISOControl(it) && it !in '‪'..'‮' && it !in '⁦'..'⁩' }
      .trim().trimStart('.').trim()
    if (base.isEmpty()) return "Shared file"
    return if (base.codePointCount(0, base.length) <= MAX_NAME) base else base.substring(0, base.offsetByCodePoints(0, MAX_NAME))
  }

  // file:// (or any scheme but content://) could point Nexus at its own private files.
  fun allowedScheme(scheme: String?): Boolean = scheme.equals("content", ignoreCase = true)

  // Nexus copies in its own process, so its own providers and its own storage must never be the source.
  fun sourceAllowed(
    scheme: String?,
    authority: String?,
    host: String?,
    ownAuthorities: Collection<String>,
    ownPackage: String,
    resolvedPackage: String?,
    realPath: String?,
    ownDirs: Collection<String>,
  ): Boolean {
    if (!allowedScheme(scheme)) return false
    // ContentResolver strips a "0@" user-id prefix when it resolves, so '@' or a ':' port could slip past the checks below.
    if (authority.isNullOrEmpty() || '@' in authority || ':' in authority || host.isNullOrEmpty()) return false
    val asked = authority.lowercase(Locale.ROOT)
    if (ownAuthorities.any { it.trim().lowercase(Locale.ROOT) == asked }) return false
    if (resolvedPackage == ownPackage) return false
    if (realPath == null || !realPath.startsWith("/")) return true
    val path = File(realPath).normalize().path
    return ownDirs.filter { it.startsWith("/") }.map { File(it).normalize().path.trimEnd('/') }.none { dir ->
      dir.isNotEmpty() && (path == dir || path.startsWith("$dir/"))
    }
  }

  fun copyCapped(input: InputStream, output: OutputStream, cap: Long): Long {
    val buffer = ByteArray(64 * 1024)
    var total = 0L
    while (true) {
      val n = input.read(buffer)
      if (n < 0) return total
      total += n
      if (total > cap) return -1
      output.write(buffer, 0, n)
    }
  }

  fun inboxId(nowMs: Long, random: Random): String =
    nowMs.toString(36) + "-" + (1..8).map { "0123456789abcdefghijklmnopqrstuvwxyz"[random.nextInt(36)] }.joinToString("")

  fun truncate(text: CharSequence?, max: Int): String? = text?.toString()?.let { if (it.length > max) it.substring(0, max) else it }
}
