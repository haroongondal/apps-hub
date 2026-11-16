package expo.modules.haloengine.core

import expo.modules.haloengine.core.patterns.Comet
import expo.modules.haloengine.core.patterns.CornerBloom
import expo.modules.haloengine.core.patterns.EmberDrift
import expo.modules.haloengine.core.patterns.PulseRing
import expo.modules.haloengine.core.patterns.Ripple
import expo.modules.haloengine.core.patterns.SpectrumRim

object Patterns {
  /** Factories, so each overlay gets its own pattern state. One line per pattern. */
  val all: List<() -> Pattern> = listOf(
    ::PulseRing,
    ::CornerBloom,
    ::SpectrumRim,
    ::Comet,
    ::EmberDrift,
    ::Ripple,
  )

  private val byId: Map<String, () -> Pattern> by lazy { all.associateBy { it().id } }

  /** A fresh pattern for `id`; unknown ids get pulse-ring. */
  fun create(id: String): Pattern = (byId[id] ?: ::PulseRing)()
}
