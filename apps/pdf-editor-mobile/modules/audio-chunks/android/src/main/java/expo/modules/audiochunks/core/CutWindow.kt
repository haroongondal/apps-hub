package expo.modules.audiochunks.core

import java.net.URI

// Audio frames are all sync frames, so a cut after seeking to the start copies samples until the end and
// shifts their times to start at zero.
class CutWindow(startMs: Double, endMs: Double) {
  val startUs: Long
  val endUs: Long

  init {
    require(startMs >= 0 && endMs > startMs) { "A piece must start at or after 0 and end after it starts." }
    startUs = Math.round(startMs * 1000.0)
    endUs = Math.round(endMs * 1000.0)
  }

  fun keeps(sampleUs: Long): Boolean = sampleUs in 0 until endUs

  fun shifted(sampleUs: Long, firstUs: Long): Long = sampleUs - firstUs
}

fun filePath(uri: String): String {
  val parsed = URI(uri)
  require(parsed.scheme == null || parsed.scheme == "file") { "Only files on this phone can be cut." }
  return parsed.path ?: throw IllegalArgumentException("That file address has no path.")
}
