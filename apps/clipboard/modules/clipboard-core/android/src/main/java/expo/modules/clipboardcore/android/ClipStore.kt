package expo.modules.clipboardcore.android

import android.content.ClipData
import android.content.ClipDescription
import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import expo.modules.clipboardcore.core.CaptureGate
import expo.modules.clipboardcore.core.ClipKind
import expo.modules.clipboardcore.core.Expiry

private const val STRONGROOM = "com.haroon.strongroom"
private const val DISMISSED = "dismissed_fingerprint"
private const val RETENTION = "retention_days"

data class Clip(
  val id: Long,
  val at: Long,
  val kind: String,
  val text: String?,
  val mime: String?,
  val source: String?,
  val via: String,
  val grabMs: Long?,
  val pinned: Boolean,
) {
  fun toMap() = mapOf(
    "id" to id, "at" to at, "kind" to kind, "text" to text, "mime" to mime,
    "source" to source, "via" to via, "grabMs" to grabMs, "pinned" to pinned,
  )
}

class ClipStore private constructor(context: Context) : SQLiteOpenHelper(context, "clips.db", null, 1) {
  @Volatile private var lastFingerprint: Int? = null
  private val prefs = context.getSharedPreferences("clip_store", Context.MODE_PRIVATE)

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      "CREATE TABLE clips (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, " +
        "text TEXT, mime TEXT, source TEXT, via TEXT NOT NULL, grab_ms INTEGER, pinned INTEGER NOT NULL DEFAULT 0)",
    )
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

  fun capture(resolver: ContentResolver, clip: ClipData?, source: String?, via: String, grabMs: Long?): Boolean {
    if (clip == null || clip.itemCount == 0 || source == STRONGROOM) return false
    val desc = clip.description
    val sensitive = desc.extras?.getBoolean(ClipDescription.EXTRA_IS_SENSITIVE) == true
    val item = clip.getItemAt(0)
    val text = item.text?.toString()
    val uri = item.uri
    val mime = uri?.let { runCatching { resolver.getType(it) }.getOrNull() }
      ?: (0 until desc.mimeTypeCount).firstNotNullOfOrNull { desc.getMimeType(it) }
    val kind = ClipKind.of(sensitive, text, if (text == null && uri != null) mime else null) ?: return false
    val fingerprint = (text ?: uri.toString()).hashCode()
    return add(kind, if (kind.hidden) null else text ?: uri?.toString(), mime, source, via, grabMs, fingerprint)
  }

  // Hidden clips dedupe on an in-memory fingerprint only: a hash stored on disk would leak them.
  @Synchronized
  private fun add(kind: ClipKind, text: String?, mime: String?, source: String?, via: String, grabMs: Long?, fingerprint: Int): Boolean {
    val dismissed = if (prefs.contains(DISMISSED)) prefs.getInt(DISMISSED, 0) else null
    if (CaptureGate.skip(via, fingerprint, lastFingerprint, dismissed)) return false
    lastFingerprint = fingerprint
    val db = writableDatabase
    prune(db)
    if (!kind.hidden) {
      db.rawQuery("SELECT kind, text FROM clips ORDER BY at DESC, id DESC LIMIT 1", null).use { c ->
        if (c.moveToFirst() && c.getString(0) == kind.id && c.getString(1) == text) return false
      }
    }
    db.insert("clips", null, ContentValues().apply {
      put("at", System.currentTimeMillis())
      put("kind", kind.id)
      put("text", text)
      put("mime", mime)
      put("source", source)
      put("via", via)
      put("grab_ms", grabMs)
    })
    prefs.edit().remove(DISMISSED).apply()
    return true
  }

  // Deleting the newest clip remembers it, so the same clipboard isn't saved again on the next open.
  @Synchronized
  fun remove(id: Long) {
    val db = writableDatabase
    val newest = newest(db)
    db.delete("clips", "id = ?", arrayOf(id.toString()))
    if (newest?.first != id) return
    forget(newest.second)
  }

  /** Deletes every clip. The newest is remembered like a single delete, so it isn't saved again on the next open. */
  @Synchronized
  fun clearAll() {
    val db = writableDatabase
    val newest = newest(db)
    db.delete("clips", null, null)
    forget(newest?.second)
  }

  private fun newest(db: SQLiteDatabase): Pair<Long, String?>? =
    db.rawQuery("SELECT id, text FROM clips ORDER BY at DESC, id DESC LIMIT 1", null).use { c ->
      if (c.moveToFirst()) c.getLong(0) to c.getString(1) else null
    }

  private fun forget(text: String?) {
    lastFingerprint = null
    text?.let { prefs.edit().putInt(DISMISSED, it.hashCode()).apply() }
  }

  /** Pinned clips first, then newest first. Expired clips are deleted before reading. */
  @Synchronized
  fun recent(limit: Int): List<Clip> {
    val db = writableDatabase
    prune(db)
    return db.rawQuery(
      "SELECT id, at, kind, text, mime, source, via, grab_ms, pinned FROM clips ORDER BY pinned DESC, at DESC, id DESC LIMIT ?",
      arrayOf(limit.toString()),
    ).use { c ->
      buildList {
        while (c.moveToNext()) {
          add(Clip(c.getLong(0), c.getLong(1), c.getString(2), c.getString(3), c.getString(4), c.getString(5),
            c.getString(6), if (c.isNull(7)) null else c.getLong(7), c.getInt(8) != 0))
        }
      }
    }
  }

  @Synchronized
  fun setPinned(id: Long, pinned: Boolean) {
    writableDatabase.update("clips", ContentValues().apply { put("pinned", if (pinned) 1 else 0) }, "id = ?", arrayOf(id.toString()))
  }

  fun retentionDays(): Int = Expiry.days(if (prefs.contains(RETENTION)) prefs.getInt(RETENTION, 0) else null)

  @Synchronized
  fun setRetentionDays(days: Int) {
    prefs.edit().putInt(RETENTION, Expiry.days(days)).apply()
    prune(writableDatabase)
  }

  private fun prune(db: SQLiteDatabase) {
    val now = System.currentTimeMillis()
    val days = retentionDays()
    val expired = db.rawQuery("SELECT id, kind, at, pinned FROM clips", null).use { c ->
      buildList { while (c.moveToNext()) if (Expiry.expired(c.getString(1), c.getLong(2), c.getInt(3) != 0, now, days)) add(c.getLong(0)) }
    }
    if (expired.isEmpty()) return
    db.beginTransaction()
    try {
      expired.forEach { db.delete("clips", "id = ?", arrayOf(it.toString())) }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  /** The clip's text, moved to the top, or null when it has none to put back (hidden, image, file). */
  @Synchronized
  fun reuse(id: Long): String? {
    val db = writableDatabase
    val text = db.rawQuery("SELECT text FROM clips WHERE id = ? AND kind = 'text'", arrayOf(id.toString())).use { c ->
      if (c.moveToFirst()) c.getString(0) else null
    } ?: return null
    db.update("clips", ContentValues().apply { put("at", System.currentTimeMillis()) }, "id = ?", arrayOf(id.toString()))
    lastFingerprint = text.hashCode()
    return text
  }

  companion object {
    @Volatile private var instance: ClipStore? = null
    @Volatile var onAdded: (() -> Unit)? = null

    fun get(context: Context): ClipStore =
      instance ?: synchronized(this) { instance ?: ClipStore(context.applicationContext).also { instance = it } }
  }
}
