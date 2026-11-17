package expo.modules.designmedia.vision

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import expo.modules.designmedia.core.ClipModels
import expo.modules.designmedia.core.ModelFile
import expo.modules.designmedia.core.TILE_IN
import expo.modules.designmedia.core.VisionModels
import expo.modules.designmedia.core.alphaMask
import expo.modules.designmedia.core.modnetInput
import expo.modules.designmedia.core.modnetSize
import expo.modules.designmedia.core.u2Input
import expo.modules.designmedia.core.withAlpha
import java.io.File
import java.nio.FloatBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

// Cut-out and upscale on the phone; DesignMediaModule only delegates here. Reads a file in the cache, writes a PNG beside it.
object Vision {
  const val EVENT_PROGRESS = "onVisionProgress"

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
    val tool = when (op) {
      "cutout" -> option.takeIf { it != "upscale" }
      "upscale" -> "upscale".takeIf { option == "2" || option == "4" }
      else -> null
    }
    val model = requireNotNull(VisionModels.TOOLS[tool]) { "unknown vision tool $op $option" }
    val flag = flags.getOrPut(id) { AtomicBoolean() }
    try {
      if (!ClipModels.isReady(modelsDir(ctx), model)) throw VisionToolMissing()
      if (!VisionPaths.allowed(ctx.cacheDir, src)) throw VisionCantOpen()
      val image = decode(src)
      return VisionJob.publish(out, flag::get) { part ->
        val result = session(ctx, model).use { s ->
          when (model) {
            VisionModels.ESRGAN -> VisionJob.upscale(image, option.toInt(), { infer(s, it, longArrayOf(1, 3, TILE_IN.toLong(), TILE_IN.toLong())).first }, flag::get, progress)
            VisionModels.U2NETP -> cutout(image, infer(s, u2Input(image.argb, image.w, image.h), longArrayOf(1, 3, 320, 320)), true, 2f)
            else -> {
              val (mw, mh) = modnetSize(image.w, image.h)
              cutout(image, infer(s, modnetInput(image.argb, image.w, image.h), longArrayOf(1, 3, mh.toLong(), mw.toLong())), false, 0f)
            }
          }
        }
        if (flag.get()) throw VisionCancelled()
        // Unpremultiplied so soft cut-out edges keep their exact colour and alpha in the PNG.
        val bmp = Bitmap.createBitmap(result.w, result.h, Bitmap.Config.ARGB_8888)
        try {
          bmp.isPremultiplied = false
          bmp.setPixels(result.argb, 0, result.w, 0, 0, result.w, result.h)
          part.outputStream().use { if (!bmp.compress(Bitmap.CompressFormat.PNG, 100, it)) throw VisionCantOpen() }
        } finally {
          bmp.recycle()
        }
      }.absolutePath
    } finally {
      flags.remove(id)
    }
  }

  private fun cutout(image: Image, pred: Pair<FloatArray, LongArray>, minMax: Boolean, featherPx: Float): Image {
    val shape = pred.second
    val mask = alphaMask(pred.first, shape.last().toInt(), shape[shape.size - 2].toInt(), image.w, image.h, minMax, featherPx)
    return Image(withAlpha(image.argb, mask), image.w, image.h)
  }

  private fun decode(src: String): Image {
    val opts = BitmapFactory.Options().apply {
      inPreferredConfig = Bitmap.Config.ARGB_8888
      inPremultiplied = false
    }
    val bmp = BitmapFactory.decodeFile(src, opts) ?: throw VisionCantOpen()
    try {
      val argb = IntArray(bmp.width * bmp.height)
      bmp.getPixels(argb, 0, bmp.width, 0, 0, bmp.width, bmp.height)
      return Image(argb, bmp.width, bmp.height)
    } finally {
      bmp.recycle()
    }
  }

  // Opened from the installed file per run and closed after it, so nothing stays in memory between edits.
  private fun session(ctx: Context, m: ModelFile): OrtSession =
    OrtSession.SessionOptions().use { opts ->
      opts.setIntraOpNumThreads(2)
      env.createSession(File(modelsDir(ctx), m.name).path, opts)
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
