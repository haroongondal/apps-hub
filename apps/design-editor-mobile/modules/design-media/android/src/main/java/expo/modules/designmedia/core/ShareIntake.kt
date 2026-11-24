package expo.modules.designmedia.core

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

const val SHARE_MAX_ITEMS = 20
const val SHARE_MAX_BYTES = 2L * 1024 * 1024 * 1024
const val SHARE_HEAD_BYTES = 16
const val SHARE_KEEP_MS = 7L * 24 * 60 * 60 * 1000
const val SHARE_REPEAT_MS = 24L * 60 * 60 * 1000
const val SHARE_SPACE_MARGIN = 64L * 1024 * 1024

class ShareTooBig : IOException("Over the size limit")

// A content address is plain host letters only: "own.authority@x", "x:1", "%2E" and similar forms can name another user's
// or this app's own provider, so anything but letters, digits, dot, dash and underscore is refused. Returns it lower-cased.
private val AUTHORITY = Regex("^[A-Za-z0-9._-]{1,255}$")

fun contentAuthority(uri: String): String? {
  if (!uri.startsWith("content://", ignoreCase = true)) return null
  val authority = uri.substring("content://".length).takeWhile { it != '/' && it != '?' && it != '#' }
  return authority.takeIf { AUTHORITY.matches(it) }?.lowercase()
}

// Our own providers (the file providers serve this app's files and cache) are never a source: another app could name
// them in a share and make this app copy its own private files. ownerOf is the system's answer for an authority.
fun isOwnAuthority(authority: String, ownAuthorities: Set<String>, ownerOf: (String) -> String?, ownPackage: String): Boolean =
  authority.lowercase() in ownAuthorities.map { it.lowercase() } || ownerOf(authority) == ownPackage

// Only content:// streams from other apps are read. A file:// address could point into this app's own folders.
data class ShareUris(val keep: List<String>, val overCap: Int, val blocked: Int)

fun acceptShareUris(uris: List<String>, max: Int = SHARE_MAX_ITEMS, isOwn: (String) -> Boolean = { false }): ShareUris {
  val distinct = uris.distinct()
  val allowed = distinct.filter { uri -> contentAuthority(uri)?.let { !isOwn(it) } == true }
  return ShareUris(allowed.take(max), (allowed.size - max).coerceAtLeast(0), distinct.size - allowed.size)
}

// The opened stream's real path (from /proc/self/fd) must not lie inside the app's private folders, whatever address named it.
fun insidePrivateDirs(realPath: String, privateDirs: List<String>): Boolean {
  val path = File(realPath).toPath().normalize()
  return privateDirs.any { path.startsWith(File(it).toPath().normalize()) }
}

fun copyCapped(input: InputStream, output: OutputStream, maxBytes: Long = SHARE_MAX_BYTES): Long {
  val buffer = ByteArray(64 * 1024)
  var total = 0L
  while (true) {
    val n = input.read(buffer)
    if (n < 0) return total
    total += n
    if (total > maxBytes) throw ShareTooBig()
    output.write(buffer, 0, n)
  }
}

fun headOf(file: File, count: Int = SHARE_HEAD_BYTES): List<Int> = file.inputStream().use { input ->
  val bytes = ByteArray(count)
  var read = 0
  while (read < count) {
    val n = input.read(bytes, read, count - read)
    if (n < 0) break
    read += n
  }
  bytes.take(read).map { it.toInt() and 0xff }
}

// The words the TS side turns into a sentence: too_big, no_space or unreadable.
fun problemOf(e: Throwable): String = when {
  e is ShareTooBig -> "too_big"
  e.message?.contains("ENOSPC") == true || e.message?.contains("No space left") == true -> "no_space"
  else -> "unreadable"
}

fun fitsOnDisk(size: Long, usable: Long): Boolean = size < 0 || usable >= size + SHARE_SPACE_MARGIN

// Batch folders are named by the time they arrived; older ones go, so shared copies never pile up.
fun expiredBatches(names: List<String>, now: Long, keepMs: Long = SHARE_KEEP_MS): List<String> =
  names.filter { name -> name.toLongOrNull()?.let { now - it > keepMs } ?: false }

// After the app is killed Android rebuilds the screen from the same share. The last taken list is kept in a small file
// (time, then one address per line); the same list within a day is that rebuild, not a new share.
fun shareRecord(uris: List<String>, now: Long): String = (listOf(now.toString()) + uris).joinToString("\n")

fun alreadyTaken(record: String?, uris: List<String>, now: Long, keepMs: Long = SHARE_REPEAT_MS): Boolean {
  val lines = record?.lines().orEmpty()
  val at = lines.firstOrNull()?.toLongOrNull() ?: return false
  return now - at in 0..keepMs && lines.drop(1) == uris
}

private val IMAGE_ENDINGS = setOf("jpg", "jpeg", "png")

fun isPictureName(name: String): Boolean = name.substringAfterLast('.', "").lowercase() in IMAGE_ENDINGS
