package expo.modules.designmedia.core

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

const val SHARE_MAX_ITEMS = 20
const val SHARE_MAX_BYTES = 2L * 1024 * 1024 * 1024
const val SHARE_HEAD_BYTES = 16
const val SHARE_KEEP_MS = 7L * 24 * 60 * 60 * 1000
const val SHARE_SPACE_MARGIN = 64L * 1024 * 1024

class ShareTooBig : IOException("Over the size limit")

// Only content:// streams are read. A file:// address from another app could point into this app's own folders.
data class ShareUris(val keep: List<String>, val overCap: Int, val blocked: Int)

fun acceptShareUris(uris: List<String>, max: Int = SHARE_MAX_ITEMS): ShareUris {
  val content = uris.distinct().filter { it.startsWith("content://") }
  return ShareUris(content.take(max), (content.size - max).coerceAtLeast(0), uris.distinct().size - content.size)
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

private val IMAGE_ENDINGS = setOf("jpg", "jpeg", "png")

fun isPictureName(name: String): Boolean = name.substringAfterLast('.', "").lowercase() in IMAGE_ENDINGS
