package expo.modules.designmedia.core

import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.floor

private const val U2 = 320
private val U2_MEAN = doubleArrayOf(0.485, 0.456, 0.406)
private val U2_STD = doubleArrayOf(0.229, 0.224, 0.225)

fun u2Input(argb: IntArray, w: Int, h: Int): FloatArray {
  val r = resize(argb, w, h, U2, U2, Filter.LANCZOS)
  var top = 0
  for (p in r) top = maxOf(top, p shr 16 and 0xFF, p shr 8 and 0xFF, p and 0xFF)
  val mx = maxOf(top.toDouble(), 1e-6)
  val plane = U2 * U2
  val out = FloatArray(3 * plane)
  for (c in 0 until 3) {
    val shift = 16 - 8 * c
    for (i in 0 until plane) out[c * plane + i] = (((r[i] shr shift and 0xFF) / mx - U2_MEAN[c]) / U2_STD[c]).toFloat()
  }
  return out
}

// Shortest edge 512 but longest <= 1024 (a 10x4000 strip would need ~200000 px and runs out of memory);
// Math.rint because the reference (sheet.modnet_cutout) uses Python's round, half to even.
fun modnetSize(w: Int, h: Int): Pair<Int, Int> {
  val s = minOf(512.0 / minOf(w, h), 1024.0 / maxOf(w, h))
  return maxOf(32, Math.rint(w * s / 32).toInt() * 32) to maxOf(32, Math.rint(h * s / 32).toInt() * 32)
}

fun modnetInput(argb: IntArray, w: Int, h: Int): FloatArray {
  val (rw, rh) = modnetSize(w, h)
  val r = resize(argb, w, h, rw, rh, Filter.BILINEAR)
  val plane = rw * rh
  val out = FloatArray(3 * plane)
  for (c in 0 until 3) {
    val shift = 16 - 8 * c
    for (i in 0 until plane) out[c * plane + i] = (r[i] shr shift and 0xFF).toFloat() / 127.5f - 1f
  }
  return out
}

private class Axis(val i0: IntArray, val i1: IntArray, val f: FloatArray)

private fun axis(nOut: Int, nIn: Int): Axis {
  val i0 = IntArray(nOut)
  val i1 = IntArray(nOut)
  val f = FloatArray(nOut)
  for (i in 0 until nOut) {
    val s = ((i + 0.5) * (nIn.toDouble() / nOut) - 0.5).coerceIn(0.0, (nIn - 1).toDouble())
    i0[i] = floor(s).toInt()
    i1[i] = minOf(i0[i] + 1, nIn - 1)
    f[i] = (s - i0[i]).toFloat()
  }
  return Axis(i0, i1, f)
}

// ref.mask_curve: smoothstep from 0.3 to 0.7 pushes half-sure alphas (a ghosted arm) to 0 or 1 before the feather; 0, 0.5
// and 1 stay put, so the subject's area at alpha 0.5 is unchanged (checked on the Phase 0 photos). One curve for both models.
fun maskCurve(a: Float): Float {
  val t = ((a - 0.5f) * 2.5f + 0.5f).coerceIn(0f, 1f) // centred so 0.5 maps to exactly 0.5 in float32
  return t * t * (3f - 2f * t)
}

// ref.u2_mask in float32 (it runs float64; a 12 MP photo would need ~200 MB more), so a pixel may differ by 1.
fun alphaMask(pred: FloatArray, pw: Int, ph: Int, w: Int, h: Int, minMax: Boolean, featherPx: Float): ByteArray {
  require(pred.size == pw * ph && w > 0 && h > 0) { "bad mask size" }
  var p = pred
  if (minMax) {
    var lo = Float.POSITIVE_INFINITY
    var hi = Float.NEGATIVE_INFINITY
    for (v in pred) { lo = minOf(lo, v); hi = maxOf(hi, v) }
    val d = maxOf(hi - lo, 1e-12f)
    p = FloatArray(pred.size) { (pred[it] - lo) / d }
  }
  val ax = axis(w, pw)
  val ay = axis(h, ph)
  var m = FloatArray(w * h)
  for (y in 0 until h) {
    val r0 = ay.i0[y] * pw
    val r1 = ay.i1[y] * pw
    val fy = ay.f[y]
    for (x in 0 until w) {
      val x0 = ax.i0[x]
      val x1 = ax.i1[x]
      val fx = ax.f[x]
      val top = p[r0 + x0] * (1 - fx) + p[r0 + x1] * fx
      val bot = p[r1 + x0] * (1 - fx) + p[r1 + x1] * fx
      m[y * w + x] = maskCurve(top * (1 - fy) + bot * fy)
    }
  }
  val out = ByteArray(w * h)
  if (featherPx <= 0f) {
    for (i in m.indices) out[i] = q8(m[i])
    return out
  }
  val r = ceil(3.0 * featherPx).toInt()
  val kd = DoubleArray(2 * r + 1) { val d = (it - r).toDouble(); exp(-d * d / (2.0 * featherPx * featherPx)) }
  val ks = kd.sum()
  val k = FloatArray(kd.size) { (kd[it] / ks).toFloat() }
  val t = FloatArray(w * h)
  for (y in 0 until h) for (x in 0 until w) {
    var s = 0f
    for (d in -r..r) s += k[d + r] * m[(y + d).coerceIn(0, h - 1) * w + x]
    t[y * w + x] = s
  }
  m = t
  for (y in 0 until h) for (x in 0 until w) {
    var s = 0f
    for (d in -r..r) s += k[d + r] * m[y * w + (x + d).coerceIn(0, w - 1)]
    out[y * w + x] = q8(s)
  }
  return out
}

private fun q8(v: Float): Byte = floor(v.coerceIn(0f, 1f) * 255f + 0.5f).toInt().toByte()

fun withAlpha(argb: IntArray, alpha: ByteArray): IntArray {
  require(argb.size == alpha.size) { "alpha size differs" }
  return IntArray(argb.size) { (argb[it] and 0xFFFFFF) or ((alpha[it].toInt() and 0xFF) shl 24) }
}
