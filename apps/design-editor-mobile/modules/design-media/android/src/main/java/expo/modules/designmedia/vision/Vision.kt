package expo.modules.designmedia.vision

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtException
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import expo.modules.designmedia.core.ClipModels
import expo.modules.designmedia.core.ModelFile
import expo.modules.designmedia.core.TILE_IN
import expo.modules.designmedia.core.UpscalePlan
import expo.modules.designmedia.core.VisionModels
import expo.modules.designmedia.core.modnetInput
import expo.modules.designmedia.core.modnetSize
import expo.modules.designmedia.core.u2Input
import expo.modules.designmedia.core.upscalePlan
import expo.modules.kotlin.exception.CodedException
import java.io.File
import java.nio.FloatBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher

// Cut-out and upscale on the phone; DesignMediaModule only delegates here. Reads a file in the cache, writes a PNG beside it.
object Vision {
  const val EVENT_PROGRESS = "onVisionProgress"

  // One process-wide thread: one full-size image at a time, whatever the number of module instances.
  val queue = CoroutineScope(Executors.newSingleThreadExecutor().asCoroutineDispatcher() + SupervisorJob())

  private val env: OrtEnvironment by lazy { OrtEnvironment.getEnvironment() }

  // getOrPut on both sides: a cancel that lands before its run starts still stops it.
  private val flags = ConcurrentHashMap<String, AtomicBoolean>()

  private fun modelsDir(ctx: Context) = File(ctx.filesDir, "models")

  fun tools(ctx: Context) = VisionModels.tools(modelsDir(ctx))

  fun install(ctx: Context, name: String) = VisionModels.install(modelsDir(ctx), name)

  fun cancel(id: String) {
    flags.getOrPut(id) { AtomicBoolean() }.set(true)
  }

  fun run(ctx: Context, id: String, op: String, src: String, option: String, progress: (Double) -> Unit): String {
    val out = VisionPaths.output(ctx.cacheDir, id)
    val model = requireNotNull(VisionJob.toolFor(op, option)) { "unknown vision tool $op $option" }
    val flag = flags.getOrPut(id) { AtomicBoolean() }
    try {
      if (!ClipModels.isReady(modelsDir(ctx), model)) throw VisionToolMissing()
      val file = VisionPaths.resolve(ctx.cacheDir, src) ?: throw VisionCantOpen()
      return VisionJob.plainWords {
        val result = if (model == VisionModels.ESRGAN) {
          var plan: UpscalePlan? = null
          // The decoder makes the plan's half-size or shrunk copy (its own filter, not LANCZOS): a full-size decode of a
          // big photo plus a LANCZOS copy would not fit the heap.
          val image = decode(file) { w, h ->
            val p = upscalePlan(w, h, option.toInt()) ?: throw VisionTooBig()
            plan = p
            (p.inW to p.inH).takeIf { p.inW != w || p.inH != h }
          }
          session(ctx, model).use { s ->
            VisionJob.upscale(image, requireNotNull(plan), { infer(s, it, longArrayOf(1, 3, TILE_IN.toLong(), TILE_IN.toLong())).first }, flag::get, progress)
          }
        } else {
          val image = decode(file, VisionJob::cutoutTarget)
          val (pred, shape) = session(ctx, model).use { s ->
            if (model == VisionModels.U2NETP) {
              infer(s, u2Input(image.argb, image.w, image.h), longArrayOf(1, 3, 320, 320))
            } else {
              val (mw, mh) = modnetSize(image.w, image.h)
              infer(s, modnetInput(image.argb, image.w, image.h), longArrayOf(1, 3, mh.toLong(), mw.toLong()))
            }
          }
          val u2 = model == VisionModels.U2NETP
          VisionJob.cutout(image, pred, shape.last().toInt(), shape[shape.size - 2].toInt(), u2, if (u2) 2f else 0f)
        }
        if (flag.get()) throw VisionCancelled()
        VisionJob.publish(out, flag::get) { part -> writePng(result, part) }.absolutePath
      }
    } finally {
      flags.remove(id)
    }
  }

  // ImageDecoder applies the JPEG's EXIF orientation; target sees the header size before any pixel is allocated.
  private fun decode(file: File, target: (Int, Int) -> Pair<Int, Int>?): Image {
    val bmp = try {
      ImageDecoder.decodeBitmap(ImageDecoder.createSource(file)) { decoder, info, _ ->
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        // ImageDecoder refuses to scale unpremultiplied pixels of a non-opaque source; getPixels unpremultiplies anyway.
        target(info.size.width, info.size.height)?.let { (w, h) -> decoder.setTargetSize(w, h) } ?: run { decoder.isUnpremultipliedRequired = true }
      }
    } catch (e: CodedException) {
      throw e
    } catch (e: Exception) {
      throw VisionCantOpen()
    }
    try {
      val argb = IntArray(bmp.width * bmp.height)
      bmp.getPixels(argb, 0, bmp.width, 0, 0, bmp.width, bmp.height)
      return Image(argb, bmp.width, bmp.height)
    } finally {
      bmp.recycle()
    }
  }

  // Unpremultiplied so soft cut-out edges keep their exact colour and alpha in the PNG.
  private fun writePng(image: Image, part: File) {
    val bmp = Bitmap.createBitmap(image.w, image.h, Bitmap.Config.ARGB_8888)
    try {
      bmp.isPremultiplied = false
      bmp.setPixels(image.argb, 0, image.w, 0, 0, image.w, image.h)
      part.outputStream().use { if (!bmp.compress(Bitmap.CompressFormat.PNG, 100, it)) throw VisionCantSave() }
    } finally {
      bmp.recycle()
    }
  }

  // Opened from the installed file per run and closed after it, so nothing stays in memory between edits.
  private fun session(ctx: Context, m: ModelFile): OrtSession =
    OrtSession.SessionOptions().use { opts ->
      opts.setIntraOpNumThreads(2)
      val file = File(modelsDir(ctx), m.name)
      try {
        env.createSession(file.path, opts)
      } catch (e: OrtException) {
        // A model that won't load (right size, bad bytes) is deleted so the next use downloads it again.
        file.delete()
        throw e
      }
    }

  // Returns the first output and its shape; names come from the session, not hard-coded.
  private fun infer(s: OrtSession, input: FloatArray, shape: LongArray): Pair<FloatArray, LongArray> =
    OnnxTensor.createTensor(env, FloatBuffer.wrap(input), shape).use { t ->
      s.run(mapOf(s.inputNames.first() to t)).use { r ->
        val o = r.get(s.outputNames.first()).get() as OnnxTensor
        val buf = o.floatBuffer
        FloatArray(buf.remaining()).also { buf.get(it) } to o.info.shape
      }
    }
}
