package expo.modules.haloengine.core

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

class FaceInput(
  var hour: Int,
  var minute: Int,
  var second: Int,
  var dateText: String,
  var batteryPct: Int,
  var charging: Boolean,
  var alarmText: String?,
  var colours: IntArray,
  var left: Float,
  var top: Float,
  var right: Float,
  var bottom: Float,
  var options: FaceOptions,
)

/** A new face is one class in core/faces/ plus one line in Faces.all (FacesTest loops it); draw only inside the bounds, FaceView adds the burn-in shift. Angles below: 0 = 12 o'clock, clockwise. */
interface Face {
  val id: String
  val name: String
  val supportsSeconds: Boolean
  fun draw(input: FaceInput, out: DrawList)
}

// Text box per px of text size, from the bundled Atkinson fonts: widest digit 0.66 em (mono 0.63), digit height 0.68 em.
const val TEXT_ADVANCE = 0.66f
const val TEXT_ASCENT = 0.72f
const val TEXT_DESCENT = 0.24f
const val LINE_GAP = 0.15f

class Line(val text: String, val sizePx: Float, val colour: Int, val font: Int)

fun two(n: Int): String = if (n < 10) "0$n" else n.toString()

fun hourText(hour: Int, h24: Boolean): String = if (h24) two(hour) else (if (hour % 12 == 0) 12 else hour % 12).toString()

fun timeText(hour: Int, minute: Int, h24: Boolean): String = hourText(hour, h24) + ":" + two(minute)

val FaceInput.main: Int get() = if (colours.isEmpty()) 0xFFFFFFFF.toInt() else colours[0]

val FaceInput.accent: Int get() = if (colours.size > 1) colours[1] else main

val FaceInput.scale: Float get() = when (options.size) { "s" -> 0.72f; "l" -> 1.3f; else -> 1f }

val FaceInput.centreX: Float get() = (left + right) / 2f

fun FaceInput.infoLine(): String {
  val b = StringBuilder()
  if (options.date) b.append(dateText)
  if (options.battery) {
    if (b.isNotEmpty()) b.append(" · ")
    b.append(batteryPct).append('%')
    if (charging) b.append(" charging")
  }
  val alarm = alarmText
  if (options.alarm && alarm != null) {
    if (b.isNotEmpty()) b.append(" · ")
    b.append("Alarm ").append(alarm)
  }
  return b.toString()
}

fun FaceInput.fitSize(text: String, wantPx: Float): Float =
  if (text.isEmpty()) wantPx else min(wantPx, (right - left) / (text.length * TEXT_ADVANCE))

fun FaceInput.blockTop(height: Float): Float {
  val third = (bottom - top) / 3f
  val centre = when (options.position) { "top" -> top + third / 2f; "bottom" -> bottom - third / 2f; else -> top + 1.5f * third }
  return (centre - height / 2f).coerceIn(top, max(top, bottom - height))
}

fun lineHeight(sizePx: Float): Float = (TEXT_ASCENT + TEXT_DESCENT) * sizePx

fun FaceInput.textBlock(out: DrawList, vararg lines: Line) {
  val sizes = FloatArray(lines.size) { fitSize(lines[it].text, lines[it].sizePx) }
  var total = 0f
  for (i in lines.indices) if (lines[i].text.isNotEmpty()) total += (if (total > 0f) LINE_GAP * sizes[i] else 0f) + lineHeight(sizes[i])
  if (total <= 0f) return
  val k = min(1f, (bottom - top) / total)
  var y = blockTop(total * k)
  var first = true
  for (i in lines.indices) {
    val line = lines[i]
    if (line.text.isEmpty()) continue
    val s = sizes[i] * k
    if (!first) y += LINE_GAP * s
    first = false
    out.text(centreX, y + TEXT_ASCENT * s, s, line.text, line.colour, line.font, DrawList.CENTRE)
    y += lineHeight(s)
  }
}

fun arc(out: DrawList, cx: Float, cy: Float, r: Float, fromRad: Float, sweepRad: Float, colour: Int, widthPx: Float, scratch: FloatArray) {
  val full = sweepRad >= 2 * PI.toFloat()
  val n = scratch.size / 2
  val steps = if (full) n else n - 1
  for (i in 0 until n) {
    val a = fromRad + sweepRad * i / steps
    scratch[2 * i] = cx + r * sin(a)
    scratch[2 * i + 1] = cy - r * cos(a)
  }
  out.polyline(scratch, n, colour, widthPx, 0f, full)
}

fun dotRing(out: DrawList, cx: Float, cy: Float, r: Float, n: Int, every: Int, bigPx: Float, smallPx: Float, colour: Int) {
  for (i in 0 until n) {
    val a = 2 * PI.toFloat() * i / n
    out.dot(cx + r * sin(a), cy - r * cos(a), if (i % every == 0) bigPx else smallPx, colour, 0f)
  }
}

fun hand(out: DrawList, cx: Float, cy: Float, angleRad: Float, length: Float, colour: Int, widthPx: Float) =
  out.line(cx, cy, cx + length * sin(angleRad), cy - length * cos(angleRad), colour, widthPx)
