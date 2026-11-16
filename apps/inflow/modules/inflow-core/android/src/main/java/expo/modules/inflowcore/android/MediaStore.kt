package expo.modules.inflowcore.android

import expo.modules.inflowcore.core.MediaKind
import expo.modules.inflowcore.core.MediaSink
import expo.modules.inflowcore.core.RawMedia
import java.io.File
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

data class MediaRow(val id: Long, val itemId: Long, val kind: String, val mime: String, val size: Long, val file: String, val sha: String = "")

/** The `media` table, behind an interface so MediaStore runs in JVM tests. */
interface MediaIndex {
  /** Whether this item already has a file with these bytes (another item may hold the same bytes: each item keeps its own file). */
  fun has(itemId: Long, sha: String): Boolean
  /** False when this item already has the sha. */
  fun insert(itemId: Long, kind: String, mime: String, size: Long, file: String, sha: String, at: Long): Boolean
  fun get(mediaId: Long): MediaRow?
  fun forItem(itemId: Long): List<MediaRow>
}

/**
 * WhatsApp media, AES-256-GCM encrypted at rest as `[12-byte IV][ciphertext + tag]` in a file with a random name; the row lives in the
 * encrypted database. `count` receives the counters the phone check reads (mediaSaved, mediaBytes, mediaTooBig). Nothing here logs.
 */
class MediaStore(
  private val dir: File,
  mediaKey: ByteArray,
  private val index: MediaIndex,
  private val count: (name: String, by: Long) -> Unit = { _, _ -> },
) : MediaSink {
  private val key = SecretKeySpec(mediaKey, "AES")
  private val random = SecureRandom()

  override fun save(itemId: Long, m: RawMedia, at: Long): Boolean {
    if (m.bytes.isEmpty()) return false
    if (m.bytes.size > MAX_BYTES) {
      count("mediaTooBig", 1)
      return false
    }
    val sha = MessageDigest.getInstance("SHA-256").digest(m.bytes).joinToString("") { "%02x".format(it) }
    if (index.has(itemId, sha)) return false
    dir.mkdirs()
    val name = ByteArray(16).also(random::nextBytes).joinToString("") { "%02x".format(it) }
    val file = File(dir, name)
    val iv = ByteArray(12).also(random::nextBytes)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv)) }
    file.writeBytes(iv + cipher.doFinal(m.bytes))
    val stored = try {
      index.insert(itemId, MediaKind.of(m.mime), m.mime.substringBefore(';').trim().lowercase(), m.bytes.size.toLong(), name, sha, at)
    } catch (e: Exception) {
      false
    }
    if (!stored) {
      file.delete()
      return false
    }
    count("mediaSaved", 1)
    count("mediaBytes", m.bytes.size.toLong())
    return true
  }

  /** The decrypted bytes, or null when the row or file is gone or the file does not open with this key. */
  fun read(mediaId: Long): ByteArray? {
    val row = index.get(mediaId) ?: return null
    return try {
      val bytes = File(dir, row.file).readBytes()
      val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
      cipher.doFinal(bytes, 12, bytes.size - 12)
    } catch (e: Exception) {
      null
    }
  }

  companion object {
    const val MAX_BYTES = 20 * 1024 * 1024

    /** HMAC-SHA256(database key, "inflow-media"): the media key is never the database key itself. */
    fun keyFor(dbKey: ByteArray): ByteArray =
      Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(dbKey, "HmacSHA256")) }.doFinal("inflow-media".toByteArray(Charsets.US_ASCII))

    /** Deletes the stored files and, when `openDir` is given, the decrypted copies made from them (named "<file>.<ext>", see openMedia). */
    fun deleteFiles(dir: File, names: List<String>, openDir: File? = null) {
      names.forEach { name ->
        File(dir, name).delete()
        openDir?.listFiles { f -> f.name.startsWith("$name.") }?.forEach { it.delete() }
      }
    }

    /** Decrypted copies handed to a viewer, older than `olderThanMs` (0 = all). */
    fun clearOpened(openDir: File, olderThanMs: Long = 0L) {
      val now = System.currentTimeMillis()
      openDir.listFiles()?.forEach { if (now - it.lastModified() >= olderThanMs) it.delete() }
    }

    /** Files no row names (left by a rolled-back transaction or a crash) and older than `olderThanMs`. */
    fun sweep(dir: File, known: Set<String>, olderThanMs: Long = 60_000L) {
      val now = System.currentTimeMillis()
      dir.listFiles()?.forEach { if (it.name !in known && now - it.lastModified() > olderThanMs) it.delete() }
    }
  }
}

class SqlMediaIndex(private val s: SqlItemStore) : MediaIndex {
  override fun has(itemId: Long, sha: String) = s.query("SELECT 1 FROM media WHERE item_id = ? AND sha = ?", itemId, sha).use { it.moveToFirst() }

  override fun insert(itemId: Long, kind: String, mime: String, size: Long, file: String, sha: String, at: Long) =
    s.run("INSERT OR IGNORE INTO media(item_id, kind, mime, size, file, sha, at) VALUES (?, ?, ?, ?, ?, ?, ?)", itemId, kind, mime, size, file, sha, at) > 0

  override fun get(mediaId: Long) = rows("WHERE id = ?", mediaId).firstOrNull()

  override fun forItem(itemId: Long) = rows("WHERE item_id = ? ORDER BY id", itemId)

  private fun rows(tail: String, vararg args: Any?): List<MediaRow> =
    s.query("SELECT id, item_id, kind, mime, size, file, sha FROM media $tail", *args).use { c ->
      buildList { while (c.moveToNext()) add(MediaRow(c.getLong(0), c.getLong(1), c.getString(2), c.getString(3), c.getLong(4), c.getString(5), c.getString(6))) }
    }
}
