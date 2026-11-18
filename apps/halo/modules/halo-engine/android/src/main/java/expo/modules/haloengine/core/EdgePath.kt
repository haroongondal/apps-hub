package expo.modules.haloengine.core

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin

class EdgePoint {
  var x = 0f
  var y = 0f
  /** Unit normal pointing toward the middle of the screen. */
  var nx = 0f
  var ny = 0f
}

/**
 * The screen perimeter (inside `insets`, with rounded corners) as a closed path.
 * t = 0 is top-centre and grows clockwise; t wraps. Segments run top, TR arc, right, BR arc, bottom, BL arc,
 * left, TL arc; `end[i]` is the cumulative length at the end of segment i. Rebuild for a new size.
 * shortcut: punch-hole cutouts ignored, add cutout following if a notched phone is used
 */
class EdgePath(width: Float, height: Float, corners: FloatArray /*tl,tr,br,bl*/, insets: FloatArray /*l,t,r,b*/) {
  private val left = insets[0]
  private val top = insets[1]
  private val w = (width - insets[0] - insets[2]).coerceAtLeast(0f)
  private val h = (height - insets[1] - insets[3]).coerceAtLeast(0f)
  private val tl: Float
  private val tr: Float
  private val br: Float
  private val bl: Float
  private val end = FloatArray(8)

  /** Total path length in pixels. */
  val length: Float

  // Distance along the first segment (top) where top-centre sits.
  private val startOffset: Float

  init {
    val max = minOf(w, h) / 2
    fun r(v: Float) = if (v > 0f) v.coerceAtMost(max) else 0f // `!(v > 0)` also catches NaN
    tl = r(corners[0]); tr = r(corners[1]); br = r(corners[2]); bl = r(corners[3])
    val quarter = (PI / 2).toFloat()
    val len = floatArrayOf(w - tl - tr, tr * quarter, h - tr - br, br * quarter, w - br - bl, bl * quarter, h - bl - tl, tl * quarter)
    var acc = 0f
    for (i in 0 until 8) { acc += len[i]; end[i] = acc }
    length = acc
    startOffset = w / 2 - tl
  }

  fun at(t: Float, out: EdgePoint) {
    if (length <= 0f) { out.x = left; out.y = top; out.nx = 0f; out.ny = 1f; return }
    var s = (t - floor(t)) * length + startOffset
    if (s >= length) s -= length
    // Binary search for the first segment that ends after s.
    var lo = 0
    var hi = 7
    while (lo < hi) {
      val mid = (lo + hi) ushr 1
      if (end[mid] > s) hi = mid else lo = mid + 1
    }
    val d = s - (if (lo == 0) 0f else end[lo - 1])
    val right = left + w
    val bottom = top + h
    when (lo) {
      0 -> line(left + tl + d, top, 0f, 1f, out)
      2 -> line(right, top + tr + d, -1f, 0f, out)
      4 -> line(right - br - d, bottom, 0f, -1f, out)
      6 -> line(left, bottom - bl - d, 1f, 0f, out)
      1 -> arc(right - tr, top + tr, tr, -PI.toFloat() / 2, d, out)
      3 -> arc(right - br, bottom - br, br, 0f, d, out)
      5 -> arc(left + bl, bottom - bl, bl, PI.toFloat() / 2, d, out)
      else -> arc(left + tl, top + tl, tl, PI.toFloat(), d, out)
    }
  }

  private fun line(x: Float, y: Float, nx: Float, ny: Float, out: EdgePoint) {
    out.x = x; out.y = y; out.nx = nx; out.ny = ny
  }

  private fun arc(cx: Float, cy: Float, r: Float, a0: Float, d: Float, out: EdgePoint) {
    val a = a0 + if (r > 0f) d / r else 0f
    val c = cos(a)
    val s = sin(a)
    out.x = cx + r * c; out.y = cy + r * s; out.nx = -c; out.ny = -s
  }
}
