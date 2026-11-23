package expo.modules.haloengine.core.faces

import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.Face
import expo.modules.haloengine.core.FaceInput
import expo.modules.haloengine.core.Line
import expo.modules.haloengine.core.accent
import expo.modules.haloengine.core.hourText
import expo.modules.haloengine.core.infoLine
import expo.modules.haloengine.core.main
import expo.modules.haloengine.core.scale
import expo.modules.haloengine.core.textBlock
import expo.modules.haloengine.core.two
import expo.modules.haloengine.core.withAlpha
import kotlin.math.min

class Stacked : Face {
  override val id = "stacked"
  override val name = "Stacked"
  override val supportsSeconds = false

  override fun draw(input: FaceInput, out: DrawList) = with(input) {
    val base = min(right - left, bottom - top) * 0.34f * scale
    textBlock(
      out,
      Line(hourText(hour, options.h24), base, main, DrawList.BOLD),
      Line(two(minute), base, accent, DrawList.BOLD),
      Line(infoLine(), base * 0.16f, withAlpha(main, 0.75f), DrawList.REGULAR),
    )
  }
}
