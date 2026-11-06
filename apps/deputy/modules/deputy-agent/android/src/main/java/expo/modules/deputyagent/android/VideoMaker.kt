package expo.modules.deputyagent.android

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.HandlerThread
import android.provider.MediaStore
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.effect.Presentation
import androidx.media3.effect.RgbMatrix
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import expo.modules.deputyagent.core.Action
import expo.modules.deputyagent.core.Photo
import expo.modules.deputyagent.core.Slideshow
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.coroutines.resume

internal class VideoMaker(private val context: Context) {
  private val images = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)

  private fun allowed() = context.checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED

  fun added(sinceMs: Long): List<String> {
    if (!allowed()) return emptyList()
    val col = MediaStore.Images.Media.DISPLAY_NAME
    val added = MediaStore.Images.Media.DATE_ADDED
    return context.contentResolver.query(images, arrayOf(col), "$added >= ?", arrayOf("${sinceMs / 1_000}"), "$added, ${MediaStore.Images.Media._ID}")?.use { c ->
      buildList { while (c.moveToNext()) add(c.getString(0).orEmpty()) }
    }.orEmpty()
  }

  suspend fun make(action: Action.MakeVideo): String {
    if (!allowed()) return "Deputy may not read photos. The owner can allow it in Deputy's Settings, under Setup."
    val picked = Slideshow.pick(action.photos, library(action.photos))
    if (picked.photos.isEmpty()) return "None of these photos are on the phone: ${picked.missing.joinToString()}. Download them first."
    val name = "deputy-${SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())}.mp4"
    val temp = File(context.cacheDir, name)
    try {
      render(picked.photos, action.secondsEach * 1_000_000L, temp)?.let { return "The video couldn't be made: $it" }
      try {
        publish(temp, name)
      } catch (e: Exception) {
        return "The video was made but couldn't be saved to the gallery: ${e.message}"
      }
    } finally {
      temp.delete()
    }
    val skipped = if (picked.missing.isEmpty()) "" else " Not found, so left out: ${picked.missing.joinToString()}."
    return "${Slideshow.SAVED}Movies/Deputy/$name,${picked.photos.size * action.secondsEach} s, from ${picked.photos.joinToString { it.name }}.$skipped"
  }

  private fun library(names: List<String>): List<Photo> {
    val prefixes = names.map(Slideshow::prefix).distinct()
    val cols = arrayOf(
      MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.DATE_ADDED,
      MediaStore.Images.Media.WIDTH, MediaStore.Images.Media.HEIGHT, MediaStore.Images.Media.ORIENTATION,
    )
    val where = prefixes.joinToString(" OR ") { "${MediaStore.Images.Media.DISPLAY_NAME} LIKE ?" }
    return context.contentResolver.query(images, cols, where, prefixes.map { "$it%" }.toTypedArray(), null)?.use { c ->
      buildList {
        while (c.moveToNext()) {
          val turned = c.getInt(5) % 180 != 0
          val (w, h) = c.getInt(3) to c.getInt(4)
          add(Photo(c.getLong(0), c.getString(1).orEmpty(), c.getLong(2), if (turned) h else w, if (turned) w else h))
        }
      }
    }.orEmpty()
  }

  /** Null when the MP4 is written, else Media3's reason. */
  private suspend fun render(photos: List<Photo>, eachUs: Long, out: File): String? {
    val (width, height) = Slideshow.frame(photos)
    val fade = RgbMatrix { timeUs, _ ->
      val f = Slideshow.fade(timeUs, eachUs)
      floatArrayOf(f, 0f, 0f, 0f, 0f, f, 0f, 0f, 0f, 0f, f, 0f, 0f, 0f, 0f, 1f)
    }
    val effects = Effects(emptyList(), listOf(Presentation.createForWidthAndHeight(width, height, Presentation.LAYOUT_SCALE_TO_FIT), fade))
    val items = photos.map { p ->
      val item = MediaItem.Builder().setUri(ContentUris.withAppendedId(images, p.id)).setImageDurationMs(eachUs / 1_000).build()
      EditedMediaItem.Builder(item).setFrameRate(FPS).setEffects(effects).build()
    }
    val composition = Composition.Builder(EditedMediaItemSequence.Builder(items).build()).build()
    val thread = HandlerThread("deputy-video").apply { start() }
    val handler = Handler(thread.looper)
    try {
      return suspendCancellableCoroutine { cont ->
        handler.post {
          if (!cont.isActive) return@post
          val transformer = Transformer.Builder(context).setLooper(thread.looper).setVideoMimeType(MimeTypes.VIDEO_H264)
            .addListener(object : Transformer.Listener {
              override fun onCompleted(composition: Composition, result: ExportResult) = cont.resume(null)
              override fun onError(composition: Composition, result: ExportResult, exception: ExportException) =
                cont.resume(exception.message ?: "Media3 error ${exception.errorCode}")
            })
            .build()
          cont.invokeOnCancellation { handler.post { transformer.cancel() } }
          transformer.start(composition, out.absolutePath)
        }
      }
    } finally {
      thread.quitSafely()
    }
  }

  private fun publish(temp: File, name: String) {
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, name)
      put(MediaStore.MediaColumns.MIME_TYPE, MimeTypes.VIDEO_MP4)
      put(MediaStore.MediaColumns.RELATIVE_PATH, "Movies/Deputy")
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val uri = requireNotNull(resolver.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values)) { "MediaStore refused the video." }
    try {
      requireNotNull(resolver.openOutputStream(uri)) { "MediaStore couldn't open the video." }.use { out -> temp.inputStream().use { it.copyTo(out) } }
      resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
      resolver.delete(uri, null, null)
      throw e
    }
  }

  private companion object {
    const val FPS = 30
  }
}
