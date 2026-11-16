package expo.modules.haloengine.core

import expo.modules.haloengine.core.patterns.Breath
import expo.modules.haloengine.core.patterns.Comet
import expo.modules.haloengine.core.patterns.CornerBloom
import expo.modules.haloengine.core.patterns.DashRun
import expo.modules.haloengine.core.patterns.EmberDrift
import expo.modules.haloengine.core.patterns.Lantern
import expo.modules.haloengine.core.patterns.MirrorBars
import expo.modules.haloengine.core.patterns.NeonTube
import expo.modules.haloengine.core.patterns.Prism
import expo.modules.haloengine.core.patterns.PulseRing
import expo.modules.haloengine.core.patterns.Ripple
import expo.modules.haloengine.core.patterns.Scanner
import expo.modules.haloengine.core.patterns.SpectrumRim
import expo.modules.haloengine.core.patterns.TwinFlare

object Patterns {
  /** Factories, so each overlay gets its own pattern state. One line per pattern. */
  val all: List<() -> Pattern> = listOf(
    ::PulseRing,
    ::CornerBloom,
    ::Breath,
    ::TwinFlare,
    ::Prism,
    ::Lantern,
    ::SpectrumRim,
    ::Comet,
    ::MirrorBars,
    ::DashRun,
    ::NeonTube,
    ::Scanner,
    ::EmberDrift,
    ::Ripple,
  )

  private val byId: Map<String, () -> Pattern> by lazy { all.associateBy { it().id } }

  /** A fresh pattern for `id`; unknown ids get pulse-ring. */
  fun create(id: String): Pattern = (byId[id] ?: ::PulseRing)()
}
