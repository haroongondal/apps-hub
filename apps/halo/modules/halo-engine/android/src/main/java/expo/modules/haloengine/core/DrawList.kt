package expo.modules.haloengine.core

// Reused primitive arrays (no per-frame allocation after warm-up); renderer reads op i's points as x,y pairs at
// points[start[i] ..] for count[i] points; size = width or dot radius px, glow = blur radius px.
class DrawList {
  var opCount = 0; private set
  var kind = IntArray(64); private set
  var color = IntArray(64); private set
  var size = FloatArray(64); private set
  var glow = FloatArray(64); private set
  var closed = BooleanArray(64); private set
  var start = IntArray(64); private set
  var count = IntArray(64); private set
  var points = FloatArray(1024); private set
  private var used = 0

  fun clear() { opCount = 0; used = 0 }

  fun polyline(xy: FloatArray, n: Int, color: Int, widthPx: Float, glow: Float, closed: Boolean) {
    if (n < 2) return
    val at = reserve(2 * n)
    System.arraycopy(xy, 0, points, at, 2 * n)
    add(POLYLINE, color, widthPx, glow, closed, at, n)
  }

  fun dot(x: Float, y: Float, radiusPx: Float, color: Int, glow: Float) {
    val at = reserve(2)
    points[at] = x
    points[at + 1] = y
    add(DOT, color, radiusPx, glow, false, at, 1)
  }

  fun mirrorX(from: Int, axisX: Float) {
    val end = opCount
    for (i in from until end) {
      val n = count[i]
      val at = reserve(2 * n)
      val src = start[i]
      for (k in 0 until n) {
        points[at + 2 * k] = 2 * axisX - points[src + 2 * k]
        points[at + 2 * k + 1] = points[src + 2 * k + 1]
      }
      add(kind[i], color[i], size[i], glow[i], closed[i], at, n)
    }
  }

  private fun reserve(floats: Int): Int {
    val at = used
    if (at + floats > points.size) points = points.copyOf(maxOf(points.size * 2, at + floats))
    used += floats
    return at
  }

  private fun add(k: Int, c: Int, s: Float, g: Float, cl: Boolean, at: Int, n: Int) {
    if (opCount == kind.size) {
      val cap = opCount * 2
      kind = kind.copyOf(cap); color = color.copyOf(cap); size = size.copyOf(cap); glow = glow.copyOf(cap)
      closed = closed.copyOf(cap); start = start.copyOf(cap); count = count.copyOf(cap)
    }
    kind[opCount] = k; color[opCount] = c; size[opCount] = s; glow[opCount] = g
    closed[opCount] = cl; start[opCount] = at; count[opCount] = n
    opCount++
  }

  companion object {
    const val POLYLINE = 0
    const val DOT = 1
  }
}
