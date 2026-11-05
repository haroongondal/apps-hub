package expo.modules.designmedia.core

data class ItemSpec(val uri: String, val startUs: Long, val endUs: Long, val keepAudio: Boolean)

fun composeItems(plan: ComposePlan): List<ItemSpec> =
  plan.clips.map { ItemSpec(it.uri, microseconds(it.inS), microseconds(it.outS), it.hasAudio) }

// A silent clip among clips with sound needs a silent track, or the sequence has a gap in its sound.
fun forceAudio(plan: ComposePlan): Boolean = plan.clips.any { it.hasAudio }
