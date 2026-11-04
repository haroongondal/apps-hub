package expo.modules.designmedia.core

enum class Verdict { WRITE, SKIP, DONE }

// Decides, sample by sample, what a lossless clip writes. Samples before the keyframe or after the end are
// dropped; a track is finished only after LOOKAHEAD samples past the end, because B-frames arrive out of order.
class ClipWindow(private val baseUs: Long, private val endUs: Long) {
  private var past = 0

  fun check(ptsUs: Long): Verdict = when {
    ptsUs > endUs -> if (++past >= LOOKAHEAD) Verdict.DONE else Verdict.SKIP
    ptsUs < baseUs -> Verdict.SKIP
    else -> Verdict.WRITE
  }

  fun shifted(ptsUs: Long): Long = ptsUs - baseUs

  companion object {
    const val LOOKAHEAD = 16
  }
}

data class TrackRef(val index: Int, val mime: String) {
  val isVideo get() = mime.startsWith("video/")
  val isAudio get() = mime.startsWith("audio/")
}

// Video tracks first: MediaExtractor seeks every selected track by the first one.
fun videoFirst(tracks: List<TrackRef>): List<TrackRef> = tracks.sortedBy { if (it.isVideo) 0 else 1 }

// Which tracks a convert copies: the first audio track for a .m4a, else every video track and (unless muted) every audio track.
fun remuxSelection(tracks: List<TrackRef>, plan: ConvertPlan): List<TrackRef> =
  if (plan.container == "m4a") tracks.filter { it.isAudio }.take(1)
  else videoFirst(tracks.filter { it.isVideo || (it.isAudio && plan.audio != null) })

fun microseconds(seconds: Double): Long = Math.round(seconds * 1_000_000.0)
