package expo.modules.haloengine.core

import expo.modules.haloengine.core.faces.ArcProgress
import expo.modules.haloengine.core.faces.BigDigits
import expo.modules.haloengine.core.faces.BigHour
import expo.modules.haloengine.core.faces.BinaryDots
import expo.modules.haloengine.core.faces.MinimalLine
import expo.modules.haloengine.core.faces.Orbit
import expo.modules.haloengine.core.faces.RingAnalog
import expo.modules.haloengine.core.faces.Stacked
import expo.modules.haloengine.core.faces.Vertical
import expo.modules.haloengine.core.faces.CalendarStrip
import expo.modules.haloengine.core.faces.Typewriter
import expo.modules.haloengine.core.faces.WordClock
import expo.modules.haloengine.core.faces.DualTime
import expo.modules.haloengine.core.faces.NeonOutline
import expo.modules.haloengine.core.faces.SplitFlap

object Faces {
  /** Factories, one line per face. */
  val all: List<() -> Face> = listOf(
    ::BigDigits,
    ::RingAnalog,
    ::Stacked,
    ::MinimalLine,
    ::BigHour,
    ::Vertical,
    ::BinaryDots,
    ::Orbit,
    ::ArcProgress,
    ::WordClock,
    ::Typewriter,
    ::CalendarStrip,
    ::SplitFlap,
    ::DualTime,
    ::NeonOutline,
  )

  private val byId: Map<String, () -> Face> by lazy { all.associateBy { it().id } }

  /** A fresh face for `id`; unknown ids get big-digits. */
  fun create(id: String): Face = (byId[id] ?: ::BigDigits)()
}
