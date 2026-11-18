package expo.modules.notchisland.core

// Largest power of two that still leaves the longer side at least `target` px.
fun sampleSize(width: Int, height: Int, target: Int): Int {
  val side = maxOf(width, height)
  var s = 1
  while (side / (s * 2) >= target) s *= 2
  return s
}
