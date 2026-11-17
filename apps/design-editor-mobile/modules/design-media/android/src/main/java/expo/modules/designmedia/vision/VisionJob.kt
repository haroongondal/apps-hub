package expo.modules.designmedia.vision

import ai.onnxruntime.OrtException
import expo.modules.designmedia.core.Filter
import expo.modules.designmedia.core.ModelFile
import expo.modules.designmedia.core.SCALE
import expo.modules.designmedia.core.UpscalePlan
import expo.modules.designmedia.core.VisionModels
import expo.modules.designmedia.core.alphaMask
import expo.modules.designmedia.core.hasAlpha
import expo.modules.designmedia.core.placeTile
import expo.modules.designmedia.core.resize
import expo.modules.designmedia.core.tileInput
import expo.modules.designmedia.core.tiles
import expo.modules.kotlin.exception.CodedException
import java.io.File
import java.io.IOException
import kotlin.math.sqrt

class VisionToolMissing : CodedException("This tool isn't on the phone yet.")
class VisionCantOpen : CodedException("This image can't be opened.")
class VisionTooBig : CodedException("This image is already as big as it can be.")
class VisionNoMemory : CodedException("This image is too big for this tool.")
class VisionFailed : CodedException("This tool didn't work on this image. Try again.")
class VisionCantSave : CodedException("The result couldn't be saved. Free up some space and try again.")
class VisionCancelled : CodedException("CANCELLED", "Stopped.", null)

class Image(val argb: IntArray, val w: Int, val h: Int)

// The pure half of the runners (no Android, no ORT), so the JVM tests drive it with a fake model.
object VisionJob {
  // 4096 x 3072: a cut-out source above this many pixels is decoded scaled down to fit (heap is ~256 MB).
  const val CUTOUT_MAX_PIXELS = 12_582_912L

  fun toolFor(op: String, option: String): ModelFile? = when (op) {
    "cutout" -> VisionModels.TOOLS[option].takeIf { option != "upscale" }
    "upscale" -> VisionModels.TOOLS["upscale"].takeIf { option == "2" || option == "4" }
    else -> null
  }

  // The decode size for a cut-out source, or null to decode it as it is.
  fun cutoutTarget(w: Int, h: Int): Pair<Int, Int>? {
    if (w.toLong() * h <= CUTOUT_MAX_PIXELS) return null
    val s = sqrt(CUTOUT_MAX_PIXELS.toDouble() / (w.toLong() * h))
    return maxOf(1, (w * s).toInt()) to maxOf(1, (h * s).toInt())
  }

  // Raw Java and ORT messages never reach the page.
  fun <T> plainWords(block: () -> T): T = try {
    block()
  } catch (e: OutOfMemoryError) {
    throw VisionNoMemory()
  } catch (e: OrtException) {
    throw VisionFailed()
  }

  // Keeps any transparency the source already had: final alpha = min(source alpha, mask). Writes into image.argb.
  fun cutout(image: Image, pred: FloatArray, pw: Int, ph: Int, minMax: Boolean, featherPx: Float): Image {
    val mask = alphaMask(pred, pw, ph, image.w, image.h, minMax, featherPx)
    val px = image.argb
    for (i in px.indices) px[i] = (px[i] and 0xFFFFFF) or (minOf(px[i] ushr 24, mask[i].toInt() and 0xFF) shl 24)
    return image
  }

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

  // input is already plan.inW x plan.inH (the decoder makes that copy) and the output is exactly 4x it. With alpha, the model runs on premultiplied RGB
  // (Pillow's RGBa) so transparent pixels can't bleed a dark fringe; the output alpha is the input's alpha resized.
  fun upscale(input: Image, plan: UpscalePlan, model: (FloatArray) -> FloatArray, cancelled: () -> Boolean, progress: (Double) -> Unit): Image {
    require(input.w == plan.inW && input.h == plan.inH) { "input is not the plan's size" }
    val alpha = hasAlpha(input.argb)
    if (alpha) for (i in input.argb.indices) input.argb[i] = premultiply(input.argb[i])
    val out = stitch(input, model, cancelled, progress)
    if (alpha) {
      val a = resize(input.argb, input.w, input.h, out.w, out.h, Filter.LANCZOS)
      for (i in out.argb.indices) out.argb[i] = unpremultiply(out.argb[i], a[i] ushr 24)
    }
    return out
  }

  // Pillow's MULDIV255 rounding.
  private fun mul(c: Int, a: Int): Int = (c * a + 128).let { (it + (it shr 8)) shr 8 }

  private fun premultiply(p: Int): Int {
    val a = p ushr 24
    return (a shl 24) or (mul(p shr 16 and 0xFF, a) shl 16) or (mul(p shr 8 and 0xFF, a) shl 8) or mul(p and 0xFF, a)
  }

  private fun unpremultiply(p: Int, a: Int): Int {
    if (a == 0) return 0
    val c = { v: Int -> minOf(255, v * 255 / a) }
    return (a shl 24) or (c(p shr 16 and 0xFF) shl 16) or (c(p shr 8 and 0xFF) shl 8) or c(p and 0xFF)
  }

  // encode writes the part file; on cancel or any failure neither the part nor <id>.png is left behind.
  fun publish(out: File, cancelled: () -> Boolean, encode: (File) -> Unit): File {
    val part = File(out.path + ".part")
    try {
      out.delete()
      out.parentFile?.mkdirs()
      encode(part)
      if (cancelled()) throw VisionCancelled()
      if (!part.renameTo(out)) throw VisionCantSave()
      return out
    } catch (e: Throwable) {
      part.delete()
      out.delete()
      throw if (e is IOException) VisionCantSave() else e
    }
  }
}
