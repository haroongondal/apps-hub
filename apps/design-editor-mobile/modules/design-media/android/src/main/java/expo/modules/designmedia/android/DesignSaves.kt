package expo.modules.designmedia.android

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import android.util.Base64
import expo.modules.designmedia.core.Saves

// Writes the editor's saveFile posts as real files through MediaStore (SPEC §14.3), mirroring the
// Outputs.publish pattern. Replacing stays limited to rows this app wrote before — MediaStore only
// lets the writer touch its own entries, so a stored design re-saves under the same name instead of
// piling up "(1)" copies.
object DesignSaves {
  /** Returns the display path the page uses as its filePath, e.g. `Documents/Design Editor/Poster.json`. */
  fun publish(context: Context, name: String, ext: String, text: String?, base64: String?, filePath: String?): String {
    val resolver = context.contentResolver
    val target = Saves.target(ext)
    val collection = if (target.images) {
      MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    } else {
      MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    }
    val displayName = if (name.endsWith(".$ext", ignoreCase = true)) name else "$name.$ext"
    val bytes = if (text != null) text.toByteArray(Charsets.UTF_8) else Base64.decode(base64 ?: "", Base64.DEFAULT)

    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
      put(MediaStore.MediaColumns.MIME_TYPE, target.mime)
      put(MediaStore.MediaColumns.RELATIVE_PATH, target.folder)
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }

    val existing = if (Saves.replaces(filePath, displayName)) findRow(resolver, collection, displayName, target.folder) else null
    val uri = if (existing != null) {
      require(resolver.update(existing, values, null, null) == 1) { "MediaStore refused to reuse the file." }
      existing
    } else {
      requireNotNull(resolver.insert(collection, values)) { "MediaStore refused the save." }
    }

    try {
      // default mode is MediaStore's truncate-on-open; replacing an own row keeps its name and size spot
      resolver.openOutputStream(uri)?.use { it.write(bytes) }
        ?: throw IllegalStateException("MediaStore couldn't open the file.")
      resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
      if (existing == null) resolver.delete(uri, null, null) else resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
      throw e
    }

    // MediaStore may have renamed the inserted file on a collision; report what actually landed
    val finalName = resolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use { c ->
      if (c.moveToFirst()) c.getString(0) else displayName
    } ?: displayName
    return target.folder + finalName
  }

  private fun findRow(resolver: android.content.ContentResolver, collection: Uri, name: String, folder: String): Uri? =
    resolver.query(
      collection,
      arrayOf(MediaStore.MediaColumns._ID),
      "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?",
      arrayOf(name, folder),
      null,
    )?.use { if (it.moveToFirst()) ContentUris.withAppendedId(collection, it.getLong(0)) else null }
}
