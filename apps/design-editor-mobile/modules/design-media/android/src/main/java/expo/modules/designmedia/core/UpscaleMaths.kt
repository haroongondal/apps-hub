package expo.modules.designmedia.core

import kotlin.math.abs
import kotlin.math.floor

const val TILE = 128
const val OVERLAP = 24
const val TILE_IN = TILE + 2 * OVERLAP
const val SCALE = 4
const val MAX_SIDE = 4096
private const val SHRUNK_SIDE = MAX_SIDE / SCALE

/** (x, y): top-left of the TILE_IN window (may be negative); (x0, y0, x1, y1): the core it fills, in input px. */
data class Tile(val x: Int, val y: Int, val x0: Int, val y0: Int, val x1: Int, val y1: Int)

fun tiles(w: Int, h: Int): List<Tile> = (0 until h step TILE).flatMap { y0 ->
  (0 until w step TILE).map { x0 -> Tile(x0 - OVERLAP, y0 - OVERLAP, x0, y0, minOf(x0 + TILE, w), minOf(y0 + TILE, h)) }
}

// numpy "reflect": the edge pixel is not repeated, and it bounces as often as needed.
fun reflect(i: Int, n: Int): Int {
  if (n == 1) return 0
  val p = 2 * (n - 1)
  val m = abs(i) % p
  return if (m >= n) p - m else m
}

fun tileInput(argb: IntArray, w: Int, h: Int, t: Tile): FloatArray {
  val plane = TILE_IN * TILE_IN
  val out = FloatArray(3 * plane)
  for (yy in 0 until TILE_IN) {
    val row = reflect(t.y + yy, h) * w
    for (xx in 0 until TILE_IN) {
      val p = argb[row + reflect(t.x + xx, w)]
      val i = yy * TILE_IN + xx
      out[i] = (p shr 16 and 0xFF).toFloat() / 255f
      out[plane + i] = (p shr 8 and 0xFF).toFloat() / 255f
      out[2 * plane + i] = (p and 0xFF).toFloat() / 255f
    }
  }
  return out
}

private fun q8(v: Float): Int = floor(v.coerceIn(0f, 1f) * 255f + 0.5f).toInt()

fun placeTile(out: IntArray, outW: Int, model: FloatArray, t: Tile) {
  val n = SCALE * TILE_IN
  val plane = n * n
  require(model.size == 3 * plane) { "model output is not 3x${n}x$n" }
  val c = SCALE * OVERLAP
  for (oy in 0 until SCALE * (t.y1 - t.y0)) {
    val src = (c + oy) * n + c
    val dst = (SCALE * t.y0 + oy) * outW + SCALE * t.x0
    for (ox in 0 until SCALE * (t.x1 - t.x0)) {
      val s = src + ox
      out[dst + ox] = (0xFF shl 24) or (q8(model[s]) shl 16) or (q8(model[plane + s]) shl 8) or q8(model[2 * plane + s])
    }
  }
}

data class UpscalePlan(val inW: Int, val inH: Int, val outW: Int, val outH: Int)

private fun fit(w: Int, h: Int, side: Int): Pair<Int, Int> {
  val l = maxOf(w, h)
  return maxOf(1, Math.rint(w.toDouble() * side / l).toInt()) to maxOf(1, Math.rint(h.toDouble() * side / l).toInt())
}

fun upscalePlan(w: Int, h: Int, scale: Int): UpscalePlan? {
  require(w > 0 && h > 0 && (scale == 2 || scale == 4)) { "bad upscale request" }
  if (maxOf(w, h) >= MAX_SIDE) return null
  // Owner rule 2026-11-18: 2x runs the 4x model on a half-size copy; the output is exactly 4 x the model input.
  val (bw, bh) = if (scale == 2) maxOf(1, Math.rint(w / 2.0).toInt()) to maxOf(1, Math.rint(h / 2.0).toInt()) else w to h
  val (inW, inH) = if (maxOf(bw, bh) > SHRUNK_SIDE) fit(bw, bh, SHRUNK_SIDE) else bw to bh
  return UpscalePlan(inW, inH, SCALE * inW, SCALE * inH)
}

// The number of model runs for an inW x inH input; the page's time estimate mirrors it.
fun upscaleTiles(inW: Int, inH: Int): Int = ((inW + TILE - 1) / TILE) * ((inH + TILE - 1) / TILE)

fun hasAlpha(argb: IntArray): Boolean = argb.any { it ushr 24 != 0xFF }
