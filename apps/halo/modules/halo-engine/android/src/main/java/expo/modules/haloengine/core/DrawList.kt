package expo.modules.haloengine.core

// Reused primitive arrays (no per-frame allocation after warm-up); renderer reads op i's points as x,y pairs at
// points[start[i] ..] for count[i] points; size = width, dot radius or text size px, glow = blur radius px.
// A TEXT op is one point (the baseline anchor) plus text[i], font[i] (REGULAR..MONO), align[i] (LEFT..RIGHT).
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
  var text = arrayOfNulls<String>(64); private set
  var font = IntArray(64); private set
  var align = IntArray(64); private set
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

  fun line(x0: Float, y0: Float, x1: Float, y1: Float, color: Int, widthPx: Float) {
    val at = reserve(4)
    points[at] = x0; points[at + 1] = y0; points[at + 2] = x1; points[at + 3] = y1
    add(POLYLINE, color, widthPx, 0f, false, at, 2)
  }

  fun text(x: Float, y: Float, sizePx: Float, text: String, color: Int, font: Int, align: Int) {
    if (text.isEmpty()) return
    val at = reserve(2)
    points[at] = x
    points[at + 1] = y
    add(TEXT, color, sizePx, 0f, false, at, 1)
    this.text[opCount - 1] = text
    this.font[opCount - 1] = font.coerceIn(0, 2)
    this.align[opCount - 1] = align.coerceIn(0, 2)
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
      text[opCount - 1] = text[i]; font[opCount - 1] = font[i]; align[opCount - 1] = align[i]
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
      text = text.copyOf(cap); font = font.copyOf(cap); align = align.copyOf(cap)
    }
    kind[opCount] = k; color[opCount] = c; size[opCount] = s; glow[opCount] = g
    closed[opCount] = cl; start[opCount] = at; count[opCount] = n
    text[opCount] = null; font[opCount] = 0; align[opCount] = 0
    opCount++
  }

  companion object {
    const val POLYLINE = 0
    const val DOT = 1
    const val TEXT = 2
    const val REGULAR = 0
    const val BOLD = 1
    const val MONO = 2
    const val LEFT = 0
    const val CENTRE = 1
    const val RIGHT = 2
  }
}
