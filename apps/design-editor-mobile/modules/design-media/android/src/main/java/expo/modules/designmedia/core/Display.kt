package expo.modules.designmedia.core

// Rotation of 90 or 270 turns the coded frame on its side; the plan must use the displayed size.
fun displaySize(width: Int, height: Int, rotation: Int): Pair<Int, Int> =
  if (rotation == 90 || rotation == 270) height to width else width to height

// Height that keeps the picture's shape at a new width; used for GIF frames and thumbnails.
fun scaledHeight(srcWidth: Int, srcHeight: Int, width: Int): Int =
  if (srcWidth <= 0 || srcHeight <= 0) 0 else maxOf(1, Math.round(width.toDouble() * srcHeight / srcWidth).toInt())

// The largest size with the picture's shape that fits the box, so the preview shows black bars instead of stretching.
fun fitInside(boxW: Int, boxH: Int, width: Int, height: Int): Pair<Int, Int> {
  if (boxW <= 0 || boxH <= 0 || width <= 0 || height <= 0) return 0 to 0
  val scale = minOf(boxW.toDouble() / width, boxH.toDouble() / height)
  return Math.round(width * scale).toInt() to Math.round(height * scale).toInt()
}
