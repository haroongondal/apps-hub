package expo.modules.inflowcore.core

/** A file a notification carried, already read: never logged, stored only encrypted. */
data class RawMedia(val mime: String, val bytes: ByteArray)

/** Reads a file only when asked: Ingest calls it once an item is really new, so a repost or an app set to not record never reads anything. */
typealias MediaSupplier = () -> RawMedia?

object MediaKind {
  /** image, video, audio, document, sticker (image/webp) or other. */
  fun of(mime: String): String {
    val m = mime.substringBefore(';').trim().lowercase()
    return when {
      m == "image/webp" -> "sticker"
      m.startsWith("image/") -> "image"
      m.startsWith("video/") -> "video"
      m.startsWith("audio/") -> "audio"
      m.startsWith("application/") || m.startsWith("text/") -> "document"
      else -> "other"
    }
  }
}

fun interface MediaSink {
  /** False when the file is too big (over 20 MB), a duplicate, or could not be stored. May throw: Ingest keeps the item either way. */
  fun save(itemId: Long, m: RawMedia, at: Long): Boolean
}
