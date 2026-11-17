package expo.modules.haloengine.core

import expo.modules.haloengine.core.faces.BigDigits
import expo.modules.haloengine.core.faces.BigHour
import expo.modules.haloengine.core.faces.MinimalLine
import expo.modules.haloengine.core.faces.RingAnalog
import expo.modules.haloengine.core.faces.Stacked
import expo.modules.haloengine.core.faces.Vertical

object Faces {
  /** Factories, one line per face. */
  val all: List<() -> Face> = listOf(
    ::BigDigits,
    ::RingAnalog,
    ::Stacked,
    ::MinimalLine,
    ::BigHour,
    ::Vertical,
  )

  private val byId: Map<String, () -> Face> by lazy { all.associateBy { it().id } }

  /** A fresh face for `id`; unknown ids get big-digits. */
  fun create(id: String): Face = (byId[id] ?: ::BigDigits)()
}
