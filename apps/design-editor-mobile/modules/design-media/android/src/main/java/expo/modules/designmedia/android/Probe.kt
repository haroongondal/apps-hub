package expo.modules.designmedia.android

import android.content.Context
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.designmedia.core.displaySize

object Probe {
  fun read(context: Context, uri: Uri): Map<String, Any?> {
    val (name, bytes) = context.contentResolver
      .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
      ?.use { c -> if (c.moveToFirst()) c.getString(0).orEmpty() to c.getLong(1) else null }
      ?: (uri.lastPathSegment.orEmpty() to 0L)
    val retriever = MediaMetadataRetriever()
    val meta = try {
      retriever.setDataSource(context, uri)
      Meta(
        durationS = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull()?.div(1000) ?: 0.0,
        rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0,
        mime = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE).orEmpty(),
      )
    } finally {
      retriever.release()
    }
    val extractor = MediaExtractor()
    val tracks = try {
      extractor.setDataSource(context, uri, null)
      (0 until extractor.trackCount).map { track(it, extractor.getTrackFormat(it), meta.rotation) }
    } finally {
      extractor.release()
    }
    return mapOf(
      "id" to uri.toString(),
      "name" to name,
      "bytes" to bytes,
      "durationS" to meta.durationS,
      "container" to container(meta.mime),
      "tracks" to tracks,
    )
  }

  private fun track(index: Int, f: MediaFormat, rotation: Int): Map<String, Any?> {
    val mime = f.getString(MediaFormat.KEY_MIME).orEmpty()
    val kind = when {
      mime.startsWith("video/") -> "video"
      mime.startsWith("audio/") -> "audio"
      else -> "other"
    }
    return buildMap<String, Any?> {
      put("index", index)
      put("kind", kind)
      put("codec", codec(mime))
      if (kind == "video") {
        val w = f.intOrNull(MediaFormat.KEY_WIDTH)
        val h = f.intOrNull(MediaFormat.KEY_HEIGHT)
        if (w != null && h != null) {
          val (dw, dh) = displaySize(w, h, rotation)
          put("width", dw)
          put("height", dh)
        }
        f.intOrNull(MediaFormat.KEY_FRAME_RATE)?.let { put("fps", it) }
        put("rotation", rotation)
        val transfer = f.intOrNull(MediaFormat.KEY_COLOR_TRANSFER)
        if (transfer == MediaFormat.COLOR_TRANSFER_HLG || transfer == MediaFormat.COLOR_TRANSFER_ST2084) put("hdr", true)
      }
      if (kind == "audio") {
        f.intOrNull(MediaFormat.KEY_CHANNEL_COUNT)?.let { put("channels", it) }
        f.intOrNull(MediaFormat.KEY_SAMPLE_RATE)?.let { put("sampleRate", it) }
      }
      f.intOrNull(MediaFormat.KEY_BIT_RATE)?.let { put("bitrate", it) }
      f.getString(MediaFormat.KEY_LANGUAGE)?.let { put("language", it) }
    }
  }

  private fun MediaFormat.intOrNull(key: String): Int? = if (containsKey(key)) getInteger(key) else null

  private fun codec(mime: String): String = when (mime) {
    "video/avc" -> "h264"
    "video/hevc" -> "hevc"
    "video/x-vnd.on2.vp8" -> "vp8"
    "video/x-vnd.on2.vp9" -> "vp9"
    "video/av01" -> "av1"
    "video/mp4v-es" -> "mpeg4"
    "audio/mp4a-latm" -> "aac"
    "audio/opus" -> "opus"
    "audio/vorbis" -> "vorbis"
    "audio/ac3" -> "ac3"
    "audio/eac3" -> "eac3"
    "audio/mpeg" -> "mp3"
    "audio/flac" -> "flac"
    "audio/raw" -> "pcm"
    else -> "other"
  }

  private fun container(mime: String): String = when (mime) {
    "video/mp4", "audio/mp4" -> if (mime == "audio/mp4") "m4a" else "mp4"
    "video/quicktime" -> "mov"
    "video/x-matroska" -> "mkv"
    "video/webm" -> "webm"
    "audio/mpeg" -> "mp3"
    "audio/ogg" -> "ogg"
    "audio/wav", "audio/x-wav" -> "wav"
    "audio/flac" -> "flac"
    else -> "other"
  }

  private data class Meta(val durationS: Double, val rotation: Int, val mime: String)
}
