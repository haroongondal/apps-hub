package expo.modules.inflowcore.android

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.content.ContentUris
import android.provider.BaseColumns
import android.provider.MediaStore as AndroidMediaStore
import androidx.core.content.ContextCompat

/** The phone's photos, read only to find receipts. Needs READ_MEDIA_IMAGES, which the owner grants from Inflow. */
object Gallery {
  fun granted(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED

  /** Photos taken or added between the two times (ms), newest first. Each has its content uri and its time in ms. */
  fun between(context: Context, fromMs: Long, toMs: Long): List<Map<String, Any>> {
    val from = fromMs / 1000
    val to = toMs / 1000
    val cursor = context.contentResolver.query(
      AndroidMediaStore.Images.Media.EXTERNAL_CONTENT_URI,
      arrayOf(BaseColumns._ID, AndroidMediaStore.Images.Media.DATE_TAKEN, AndroidMediaStore.Images.Media.DATE_ADDED),
      "${AndroidMediaStore.Images.Media.DATE_TAKEN} BETWEEN ? AND ? OR ${AndroidMediaStore.Images.Media.DATE_ADDED} BETWEEN ? AND ?",
      arrayOf(fromMs.toString(), toMs.toString(), from.toString(), to.toString()),
      null,
    ) ?: return emptyList()
    return cursor.use {
      val out = ArrayList<Map<String, Any>>()
      while (it.moveToNext()) {
        val id = it.getLong(0)
        val taken = it.getLong(1)
        val added = it.getLong(2) * 1000
        val uri = ContentUris.withAppendedId(AndroidMediaStore.Images.Media.EXTERNAL_CONTENT_URI, id).toString()
        out.add(mapOf("uri" to uri, "takenAt" to if (taken > 0) taken else added))
      }
      out.sortedByDescending { it["takenAt"] as Long }
    }
  }
}
