package expo.modules.designmedia.vision

import expo.modules.designmedia.core.Filter
import expo.modules.designmedia.core.SCALE
import expo.modules.designmedia.core.hasAlpha
import expo.modules.designmedia.core.placeTile
import expo.modules.designmedia.core.resize
import expo.modules.designmedia.core.tileInput
import expo.modules.designmedia.core.tiles
import expo.modules.designmedia.core.upscalePlan
import expo.modules.kotlin.exception.CodedException
import java.io.File
import java.io.IOException

class VisionToolMissing : CodedException("This tool isn't on the phone yet.")
class VisionCantOpen : CodedException("This image can't be opened.")
class VisionTooBig : CodedException("This image is already as big as it can be.")
class VisionCancelled : CodedException("CANCELLED", "Stopped.", null)

class Image(val argb: IntArray, val w: Int, val h: Int)

// The pure half of the runners (no Android, no ORT), so the JVM tests drive it with a fake model.
object VisionJob {
  fun stitch(src: Image, model: (FloatArray) -> FloatArray, cancelled: () -> Boolean, progress: (Double) -> Unit): Image {
    val out = Image(IntArray(SCALE * src.w * SCALE * src.h), SCALE * src.w, SCALE * src.h)
    val all = tiles(src.w, src.h)
    all.forEachIndexed { i, t ->
      if (cancelled()) throw VisionCancelled()
      placeTile(out.argb, out.w, model(tileInput(src.argb, src.w, src.h, t)), t)
      progress((i + 1).toDouble() / all.size)
    }
    return out
  }

  fun upscale(src: Image, scale: Int, model: (FloatArray) -> FloatArray, cancelled: () -> Boolean, progress: (Double) -> Unit): Image {
    val plan = upscalePlan(src.w, src.h, scale) ?: throw VisionTooBig()
    val input = if (plan.inW == src.w && plan.inH == src.h) src else Image(resize(src.argb, src.w, src.h, plan.inW, plan.inH, Filter.LANCZOS), plan.inW, plan.inH)
    val big = stitch(input, model, cancelled, progress)
    val out = if (big.w == plan.outW && big.h == plan.outH) big.argb else resize(big.argb, big.w, big.h, plan.outW, plan.outH, Filter.LANCZOS)
    if (hasAlpha(src.argb)) {
      // The model sees RGB only; alpha is the source alpha resized straight to the output size.
      val a = resize(src.argb, src.w, src.h, plan.outW, plan.outH, Filter.LANCZOS)
      for (i in out.indices) out[i] = (out[i] and 0xFFFFFF) or (a[i] and -0x1000000)
    }
    return Image(out, plan.outW, plan.outH)
  }

  // encode writes the part file; on cancel or any failure neither the part nor <id>.png is left behind.
  fun publish(out: File, cancelled: () -> Boolean, encode: (File) -> Unit): File {
    val part = File(out.path + ".part")
    try {
      out.delete()
      out.parentFile?.mkdirs()
      encode(part)
      if (cancelled()) throw VisionCancelled()
      if (!part.renameTo(out)) throw IOException("Couldn't save the result.")
      return out
    } catch (e: Throwable) {
      part.delete()
      out.delete()
      throw e
    }
  }
}
