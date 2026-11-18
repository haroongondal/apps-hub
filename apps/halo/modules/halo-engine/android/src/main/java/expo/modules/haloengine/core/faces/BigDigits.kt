package expo.modules.haloengine.core.faces

import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.Face
import expo.modules.haloengine.core.FaceInput
import expo.modules.haloengine.core.Line
import expo.modules.haloengine.core.infoLine
import expo.modules.haloengine.core.main
import expo.modules.haloengine.core.scale
import expo.modules.haloengine.core.textBlock
import expo.modules.haloengine.core.timeText
import expo.modules.haloengine.core.withAlpha
import kotlin.math.min

class BigDigits : Face {
  override val id = "big-digits"
  override val name = "Big digits"
  override val supportsSeconds = false

  override fun draw(input: FaceInput, out: DrawList) = with(input) {
    val base = min(right - left, bottom - top) * 0.26f * scale
    textBlock(
      out,
      Line(timeText(hour, minute, options.h24), base, main, DrawList.BOLD),
      Line(infoLine(), base * 0.2f, withAlpha(main, 0.75f), DrawList.REGULAR),
    )
  }
}
