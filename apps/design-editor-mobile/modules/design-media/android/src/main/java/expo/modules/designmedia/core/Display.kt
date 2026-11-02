package expo.modules.designmedia.core

// Rotation of 90 or 270 turns the coded frame on its side; the plan must use the displayed size.
fun displaySize(width: Int, height: Int, rotation: Int): Pair<Int, Int> =
  if (rotation == 90 || rotation == 270) height to width else width to height
