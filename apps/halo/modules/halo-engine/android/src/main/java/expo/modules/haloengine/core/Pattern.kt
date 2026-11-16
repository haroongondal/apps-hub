package expo.modules.haloengine.core

import kotlin.math.abs
import kotlin.math.floor

enum class Family { LIGHTS, LINES, PARTICLES, WAVES }

// px values (caller converts dp); roundness shapes the caller's EdgePath corners, patterns just follow the path.
class PatternParams(
  val thicknessPx: Float = 11f,
  val speed: Float = 0.5f,
  val spread: Float = 0.5f,
  val glow: Float = 0.6f,
  val paddingPx: Float = 0f,
  val roundness: Float = 1f,
  val mirrored: Boolean = false,
  val clockwise: Boolean = true,
)

class FrameInput(
  val path: EdgePath,
  val spectrum: SpectrumFrame,
  val timeMs: Long,
  val dtMs: Long,
  val params: PatternParams,
  val colors: IntArray,
)

interface Pattern {
  val id: String
  val family: Family
  fun draw(input: FrameInput, out: DrawList)
}

val FrameInput.dt: Float get() = dtMs.coerceIn(0L, 100L) / 1000f

val FrameInput.glowPx: Float get() = params.glow * 2.5f * params.thicknessPx

// Mirrored patterns draw u 0..1 over half the edge (t 0..0.5), then call mirror(); anticlockwise runs t backwards.
fun FrameInput.t(u: Float): Float {
  val s = if (params.mirrored) u * 0.5f else u
  return if (params.clockwise) s else -s
}

fun FrameInput.pointAt(t: Float, inward: Float, out: EdgePoint) {
  path.at(t, out)
  val d = params.paddingPx + inward
  out.x += out.nx * d
  out.y += out.ny * d
}

fun FrameInput.point(u: Float, inward: Float, out: EdgePoint) = pointAt(t(u), inward, out)

fun FrameInput.mirror(out: DrawList, fromOp: Int, scratch: EdgePoint) {
  if (!params.mirrored) return
  path.at(0f, scratch)
  out.mirrorX(fromOp, scratch.x)
}

fun FrameInput.color(f: Float): Int {
  val n = colors.size
  if (n == 0) return 0xFFFFFFFF.toInt()
  if (n == 1) return colors[0]
  val x = (f - floor(f)) * n
  val i = x.toInt().coerceAtMost(n - 1)
  return lerpColor(colors[i], colors[(i + 1) % n], x - i)
}

fun band(bands: FloatArray, x: Float): Float {
  if (bands.isEmpty()) return 0f
  val p = x.coerceIn(0f, 1f) * (bands.size - 1)
  val i = p.toInt().coerceAtMost(bands.size - 1)
  val j = (i + 1).coerceAtMost(bands.size - 1)
  return bands[i] + (bands[j] - bands[i]) * (p - i)
}

fun fold(u: Float): Float = 1f - abs(2f * u - 1f)

fun withAlpha(c: Int, a: Float): Int {
  val alpha = ((c ushr 24) * a.coerceIn(0f, 1f)).toInt()
  return (alpha shl 24) or (c and 0xFFFFFF)
}

fun lerpColor(a: Int, b: Int, f: Float): Int {
  fun ch(shift: Int) = (((a ushr shift) and 0xFF) + (((b ushr shift) and 0xFF) - ((a ushr shift) and 0xFF)) * f).toInt()
  return (ch(24) shl 24) or (ch(16) shl 16) or (ch(8) shl 8) or ch(0)
}
