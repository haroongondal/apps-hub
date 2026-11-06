package expo.modules.designmedia.core

enum class Kind { VIDEO, AUDIO, IMAGE }

data class Target(val kind: Kind, val folder: String, val mime: String)

private val AUDIO_MIME = mapOf(
  "m4a" to "audio/mp4", "mp3" to "audio/mpeg", "ac3" to "audio/ac3", "eac3" to "audio/eac3",
  "opus" to "audio/ogg", "ogg" to "audio/ogg", "webm" to "audio/webm", "wav" to "audio/x-wav", "flac" to "audio/flac",
)
private val VIDEO_MIME = mapOf("mp4" to "video/mp4", "webm" to "video/webm", "mov" to "video/quicktime", "mkv" to "video/x-matroska")
private val IMAGE_MIME = mapOf("gif" to "image/gif", "png" to "image/png", "jpg" to "image/jpeg")

// Video goes to Movies, sound to Music, stills and GIFs to Pictures (SPEC §12.1), all under "Design Editor".
fun targetFor(plan: Plan): Target {
  val ext = outputExt(plan)
  val kind = when {
    plan is GifPlan || plan is FramePlan -> Kind.IMAGE
    plan is AudioPlan || ext == "m4a" -> Kind.AUDIO
    else -> Kind.VIDEO
  }
  val mime = when (kind) {
    Kind.IMAGE -> IMAGE_MIME
    Kind.AUDIO -> AUDIO_MIME
    Kind.VIDEO -> VIDEO_MIME
  }.getValue(ext)
  return Target(kind, folderOf(kind), mime)
}

fun folderOf(kind: Kind): String = when (kind) {
  Kind.IMAGE -> "Pictures/Design Editor/"
  Kind.AUDIO -> "Music/Design Editor/"
  Kind.VIDEO -> "Movies/Design Editor/"
}
