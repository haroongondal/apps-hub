package expo.modules.designmedia.android

import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.os.Bundle
import android.provider.MediaStore
import expo.modules.designmedia.core.AtomicFile
import expo.modules.designmedia.core.BLUR_DEFAULT
import expo.modules.designmedia.core.BLUR_MAX
import expo.modules.designmedia.core.BLUR_MIN
import expo.modules.designmedia.core.CleanupKind
import expo.modules.designmedia.core.CleanupOptions
import expo.modules.designmedia.core.CleanupPhoto
import expo.modules.designmedia.core.Dismissals
import expo.modules.designmedia.core.LOOKALIKE_DEFAULT
import expo.modules.designmedia.core.LOOKALIKE_STRICT
import expo.modules.designmedia.core.PhotoIndexFile
import expo.modules.designmedia.core.TRASH_KEEP_MS
import expo.modules.designmedia.core.TrashRecord
import expo.modules.designmedia.core.cleanupGroups
import expo.modules.designmedia.core.galleryImageId
import expo.modules.kotlin.exception.CodedException
import java.io.File

class NotAGalleryPhoto : CodedException("Only photos from your gallery can be used here. Pick them again and retry.")

class GalleryUnreadable : CodedException("Couldn't read your gallery. Check that the app may see your photos, then try again.")

class UnknownCleanupKind(kind: String) : CodedException("\"$kind\" isn't a Clean up kind. Use blurry, copies, lookalikes, screenshots or dark.")

object CleanupTool {
  private val IMAGES = MediaStore.Images.Media.EXTERNAL_CONTENT_URI

  private class Meta(val name: String, val bytes: Long, val takenAt: Long, val pixels: Long, val path: String?)

  fun record(ctx: Context) = TrashRecord(AtomicFile(File(ctx.filesDir, "cleanup-trash.json")))

  private fun dismissals(ctx: Context) = Dismissals(AtomicFile(File(ctx.filesDir, "cleanup-dismissed.json")))

  fun uriOf(id: Long): String = ContentUris.withAppendedId(IMAGES, id).toString()

  fun idOf(uri: String): Long? = galleryImageId(uri, IMAGES.toString())

  fun groups(ctx: Context, options: Map<String, Any?>?): Map<String, Any> {
    val rows = PhotoIndexFile.read(File(ctx.filesDir, "photo-index.bin"))
    val meta = gallery(ctx)
    // Joining against live rows drops photos already trashed or deleted since the last scan.
    val photos = rows.mapNotNull { r ->
      meta[r.key.id]?.let { CleanupPhoto(r.key.id, r.vec, r.scores, it.bytes, it.takenAt, it.pixels, it.path) }
    }
    val dismissed = dismissals(ctx).all().mapNotNullTo(HashSet()) { (wire, id) -> kindOf(wire)?.let { it to id } }
    val opts = CleanupOptions(
      (options?.get("blurThreshold") as? Number)?.toDouble() ?: BLUR_DEFAULT,
      (options?.get("lookalikeCosine") as? Number)?.toDouble() ?: LOOKALIKE_DEFAULT,
    )
    val groups = cleanupGroups(photos, dismissed, opts).map { g ->
      mapOf("kind" to g.kind.wire, "key" to g.key, "bytes" to g.bytes, "photos" to g.members.map { m ->
        val x = meta.getValue(m.id)
        mapOf("uri" to uriOf(m.id), "name" to x.name, "bytes" to x.bytes, "takenAt" to x.takenAt, "ticked" to m.ticked, "best" to m.best)
      })
    }
    return mapOf(
      "groups" to groups,
      "blur" to mapOf("min" to BLUR_MIN, "max" to BLUR_MAX, "default" to BLUR_DEFAULT),
      "lookalike" to mapOf("default" to LOOKALIKE_DEFAULT, "strict" to LOOKALIKE_STRICT),
      "indexed" to rows.size,
    )
  }

  fun recentlyRemoved(ctx: Context): List<Map<String, Any>> {
    val record = record(ctx)
    val all = record.all()
    if (all.isEmpty()) return emptyList()
    val now = System.currentTimeMillis()
    val expires = stillTrashed(ctx, all.mapNotNull { idOf(it.uri) })
    // A failed query keeps every entry: dropping one would hide a photo the owner can still restore.
    val kept = if (expires == null) all.filter { now - it.trashedAt <= TRASH_KEEP_MS } else record.recent(now, expires.keys)
    return kept.map {
      val at = expires?.get(it.uri)?.takeIf { s -> s > 0 }?.times(1000) ?: (it.trashedAt + TRASH_KEEP_MS)
      mapOf("uri" to it.uri, "name" to it.name, "bytes" to it.bytes, "trashedAt" to it.trashedAt, "expiresAt" to at)
    }
  }

  fun dismiss(ctx: Context, kind: String, uris: List<String>) {
    kindOf(kind) ?: throw UnknownCleanupKind(kind)
    dismissals(ctx).add(kind, uris.map { idOf(it) ?: throw NotAGalleryPhoto() })
  }

  fun clearDismissals(ctx: Context) = dismissals(ctx).clear()

  private fun kindOf(wire: String) = CleanupKind.entries.firstOrNull { it.wire == wire }

  private fun gallery(ctx: Context): Map<Long, Meta> {
    val cols = arrayOf(MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.SIZE,
      MediaStore.Images.Media.DATE_TAKEN, MediaStore.Images.Media.DATE_MODIFIED, MediaStore.Images.Media.WIDTH,
      MediaStore.Images.Media.HEIGHT, MediaStore.Images.Media.RELATIVE_PATH)
    val out = HashMap<Long, Meta>()
    val cursor = ctx.contentResolver.query(IMAGES, cols, null, null, null) ?: throw GalleryUnreadable()
    cursor.use { c ->
      while (c.moveToNext()) {
        val taken = if (c.isNull(3)) 0L else c.getLong(3)
        out[c.getLong(0)] = Meta(c.getString(1) ?: "", c.getLong(2), if (taken > 0) taken else c.getLong(4) * 1000,
          c.getLong(5) * c.getLong(6), c.getString(7))
      }
    }
    return out
  }

  private fun stillTrashed(ctx: Context, ids: List<Long>): Map<String, Long>? {
    if (ids.isEmpty()) return emptyMap()
    val args = Bundle().apply {
      putInt(MediaStore.QUERY_ARG_MATCH_TRASHED, MediaStore.MATCH_ONLY)
      putString(ContentResolver.QUERY_ARG_SQL_SELECTION, "${MediaStore.Images.Media._ID} IN (${ids.joinToString(",")})")
    }
    val cursor = runCatching {
      ctx.contentResolver.query(IMAGES, arrayOf(MediaStore.Images.Media._ID, MediaStore.Images.Media.DATE_EXPIRES), args, null)
    }.getOrNull() ?: return null
    return cursor.use { c ->
      buildMap { while (c.moveToNext()) put(uriOf(c.getLong(0)), if (c.isNull(1)) 0L else c.getLong(1)) }
    }
  }
}
