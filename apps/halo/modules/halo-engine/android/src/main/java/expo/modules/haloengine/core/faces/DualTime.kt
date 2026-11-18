package expo.modules.haloengine.core.faces

import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.Face
import expo.modules.haloengine.core.FaceInput
import expo.modules.haloengine.core.Line
import expo.modules.haloengine.core.accent
import expo.modules.haloengine.core.infoLine
import expo.modules.haloengine.core.main
import expo.modules.haloengine.core.scale
import expo.modules.haloengine.core.textBlock
import expo.modules.haloengine.core.timeText
import expo.modules.haloengine.core.withAlpha
import java.util.TimeZone
import kotlin.math.min

/** Local time big, UTC small below it. Offset = the device zone's offset now (FaceInput has no zone); 12 h mode shows no am/pm and no day change on the UTC line. */
class DualTime(private val offsetMinutes: () -> Int) : Face {
  constructor() : this({ TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60000 })

  override val id = "dual-time"
  override val name = "Dual time"
  override val supportsSeconds = false

  override fun draw(input: FaceInput, out: DrawList) = with(input) {
    val utc = Math.floorMod(hour * 60 + minute - offsetMinutes(), 1440)
    val base = min(right - left, bottom - top) * 0.3f * scale
    textBlock(
      out,
      Line(timeText(hour, minute, options.h24), base, main, DrawList.BOLD),
      Line(timeText(utc / 60, utc % 60, options.h24) + " UTC", base * 0.3f, accent, DrawList.MONO),
      Line(infoLine(), base * 0.16f, withAlpha(main, 0.75f), DrawList.REGULAR),
    )
  }
}
