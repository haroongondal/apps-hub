package expo.modules.designmedia.android

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import expo.modules.designmedia.core.displaySize
import expo.modules.designmedia.core.microseconds
import expo.modules.designmedia.core.scaledHeight
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.ConcurrentHashMap

object Thumbs {
  private const val QUALITY = 80
  private const val STEP_BACK_US = 100_000L

  // Each call writes a fresh set (new names, so image caches never show an old picture) and deletes every
  // file the previous calls left in the same folder, so a folder never holds more than its latest set and
  // the one-frame "preview" folder never touches the filmstrip tiles.
  private val locks = ConcurrentHashMap<String, Any>()

  // One lock per folder: a one-frame preview must not wait behind a sixty-tile filmstrip.
  fun write(context: Context, uri: Uri, timesS: List<Double>, width: Int, folder: String = "thumbs"): List<String> =
    synchronized(locks.getOrPut(folder) { Any() }) { writeFolder(context, uri, timesS, width, folder) }

  private fun writeFolder(context: Context, uri: Uri, timesS: List<Double>, width: Int, folder: String): List<String> {
    val dir = File(context.cacheDir, folder).apply { mkdirs() }
    val stamp = System.nanoTime()
    val retriever = MediaMetadataRetriever()
    val made = ArrayList<File>()
    try {
      retriever.setDataSource(context, uri)
      val coded = (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0) to
        (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0)
      val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      val durationUs = microseconds((retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0) / 1000)
      val (w, h) = displaySize(coded.first, coded.second, rotation)
      val height = scaledHeight(w, h, width)
      require(height > 0) { "No picture to show." }
      for ((i, t) in timesS.withIndex()) {
        val us = minOf(microseconds(t.coerceAtLeast(0.0)), durationUs)
        val bitmap = frame(retriever, us, width, height) ?: frame(retriever, (us - STEP_BACK_US).coerceAtLeast(0), width, height)
        if (bitmap == null) {
          made.add(made.lastOrNull() ?: throw IllegalStateException("No picture at $t."))
          continue
        }
        val file = File(dir, "thumb-$stamp-$i.jpg")
        FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, QUALITY, it) }
        bitmap.recycle()
        made.add(file)
      }
    } finally {
      retriever.release()
    }
    dir.listFiles()?.filter { it !in made }?.forEach { it.delete() }
    return made.map { Uri.fromFile(it).toString() }
  }

  private fun frame(retriever: MediaMetadataRetriever, us: Long, width: Int, height: Int): Bitmap? =
    retriever.getScaledFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST, width, height)
}
