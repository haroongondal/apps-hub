package expo.modules.designmedia.core

// Rotation of 90 or 270 turns the coded frame on its side; the plan must use the displayed size.
fun displaySize(width: Int, height: Int, rotation: Int): Pair<Int, Int> =
  if (rotation == 90 || rotation == 270) height to width else width to height

// Height that keeps the picture's shape at a new width; used for GIF frames and thumbnails.
fun scaledHeight(srcWidth: Int, srcHeight: Int, width: Int): Int =
  if (srcWidth <= 0 || srcHeight <= 0) 0 else maxOf(1, Math.round(width.toDouble() * srcHeight / srcWidth).toInt())
