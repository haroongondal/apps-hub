package expo.modules.designmedia.core

data class ItemSpec(val uri: String, val startUs: Long, val endUs: Long, val keepAudio: Boolean, val volume: Float = 1f)

// startUs and endUs are times in the audio file; gapBeforeUs is the silence since the previous piece (the first counts from 0).
data class MusicSpec(val uri: String, val startUs: Long, val endUs: Long, val gapBeforeUs: Long, val volume: Float)

fun composeItems(plan: ComposePlan): List<ItemSpec> =
  plan.clips.map { ItemSpec(it.uri, microseconds(it.inS), microseconds(it.outS), it.hasAudio, it.volume.toFloat()) }

fun musicItems(plan: ComposePlan): List<MusicSpec> {
  var endUs = 0L
  return plan.music.sortedBy { it.startS }.map { m ->
    val startUs = microseconds(m.inS)
    val stopUs = microseconds(m.outS)
    val atUs = microseconds(m.startS)
    MusicSpec(m.uri, startUs, stopUs, maxOf(0L, atUs - endUs), m.volume.toFloat()).also { endUs = atUs + stopUs - startUs }
  }
}

// A silent clip among clips with sound, or under music, needs a silent track, or the sequence has a gap in its sound.
fun forceAudio(plan: ComposePlan): Boolean = plan.clips.any { it.hasAudio } || plan.music.isNotEmpty()

fun durationMs(plan: ComposePlan): Long = composeItems(plan).sumOf { it.endUs - it.startUs } / 1000
