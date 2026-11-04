package expo.modules.designmedia.android

import android.content.Context
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.designmedia.core.displaySize
import expo.modules.designmedia.core.estimateVideoBps
import expo.modules.designmedia.core.microseconds

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

  // The largest keyframe time at or before timeS, in seconds; 0 when the file has no video or no keyframe is found.
  fun keyframeAtOrBefore(context: Context, uri: Uri, timeS: Double): Double {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(context, uri, null)
      val video = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME).orEmpty().startsWith("video/")
      } ?: return 0.0
      extractor.selectTrack(video)
      extractor.seekTo(microseconds(timeS.coerceAtLeast(0.0)), MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      return extractor.sampleTime.coerceAtLeast(0L) / 1_000_000.0
    } finally {
      extractor.release()
    }
  }

  fun bytesOf(context: Context, uri: Uri): Long = context.contentResolver
    .query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)
    ?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else 0L } ?: 0L

  // What a runner needs to know about its input: shown size (rotation applied), length, and the picture's own bit rate.
  fun source(context: Context, uri: Uri): Source {
    val bytes = bytesOf(context, uri)
    val retriever = MediaMetadataRetriever()
    var durationS = 0.0
    var rotation = 0
    var coded = 0 to 0
    try {
      retriever.setDataSource(context, uri)
      durationS = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull()?.div(1000) ?: 0.0
      rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      coded = (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0) to
        (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0)
    } finally {
      retriever.release()
    }
    var videoTrackBps: Int? = null
    var audioBps: Int? = null
    var fps: Int? = null
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(context, uri, null)
      for (i in 0 until extractor.trackCount) {
        val f = extractor.getTrackFormat(i)
        val mime = f.getString(MediaFormat.KEY_MIME).orEmpty()
        if (mime.startsWith("video/") && videoTrackBps == null) {
          videoTrackBps = f.intOrNull(MediaFormat.KEY_BIT_RATE)
          fps = f.intOrNull(MediaFormat.KEY_FRAME_RATE)
        } else if (mime.startsWith("audio/") && audioBps == null) {
          audioBps = f.intOrNull(MediaFormat.KEY_BIT_RATE)
        }
      }
    } finally {
      extractor.release()
    }
    val (w, h) = displaySize(coded.first, coded.second, rotation)
    return Source(bytes, durationS, rotation, w, h, fps, estimateVideoBps(videoTrackBps, bytes, durationS, audioBps))
  }

  class Source(
    val bytes: Long, val durationS: Double, val rotation: Int, val width: Int, val height: Int, val fps: Int?, val videoBps: Int?,
  )

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
