package expo.modules.designmedia.core

import java.io.OutputStream
import java.util.concurrent.CancellationException

object GifWriter {
  const val PALETTE_FRAMES = 8
  const val MIN_DELAY_CS = 2

  // Frame i lasts round((i+1)*100/fps) - round(i*100/fps) centiseconds, so 12 fps stays 12 fps over the whole clip.
  fun delaysCs(fps: Int, count: Int): IntArray = IntArray(count) {
    maxOf(MIN_DELAY_CS, Math.round((it + 1) * 100.0 / fps).toInt() - Math.round(it * 100.0 / fps).toInt())
  }

  fun paletteFrames(count: Int): List<Int> {
    val n = minOf(PALETTE_FRAMES, count)
    return (0 until n).map { if (n == 1) 0 else it * (count - 1) / (n - 1) }.distinct()
  }

  // One frame is in memory at a time: `frame(i, rgb)` fills 0xRRGGBB pixels for frame i and is called once per
  // palette sample, then once per frame in order. Throws CancellationException when `cancelled` turns true.
  fun write(
    out: OutputStream, width: Int, height: Int, fps: Int, count: Int,
    frame: (Int, IntArray) -> Unit, progress: (Double) -> Unit = {}, cancelled: () -> Boolean = { false },
  ) {
    require(count > 0 && width > 0 && height > 0) { "A GIF needs at least one pixel and one frame." }
    val rgb = IntArray(width * height)
    val samples = paletteFrames(count)
    val total = (samples.size + count).toDouble()
    val histogram = Histogram()
    var done = 0
    for (i in samples) {
      if (cancelled()) throw CancellationException()
      frame(i, rgb)
      histogram.add(rgb)
      progress(++done / total)
    }
    val palette = histogram.palette(256)
    val encoder = GifEncoder(out, width, height, palette)
    val dither = Dither(palette)
    val indices = ByteArray(width * height)
    val delays = delaysCs(fps, count)
    for (i in 0 until count) {
      if (cancelled()) throw CancellationException()
      frame(i, rgb)
      dither.apply(rgb, width, height, indices)
      encoder.writeFrame(indices, delays[i])
      progress(++done / total)
    }
    encoder.finish()
  }

  fun frameCount(startS: Double, endS: Double, fps: Int): Int = maxOf(1, Math.floor((endS - startS) * fps + 1e-9).toInt())

  fun frameTimeS(startS: Double, fps: Int, index: Int): Double = startS + index.toDouble() / fps
}
