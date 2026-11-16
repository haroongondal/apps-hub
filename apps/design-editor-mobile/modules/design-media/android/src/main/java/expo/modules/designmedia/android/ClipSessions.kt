package expo.modules.designmedia.android

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import expo.modules.designmedia.core.ClipModels
import expo.modules.designmedia.core.ModelFile
import java.io.File
import java.nio.FloatBuffer
import java.nio.LongBuffer

// The image session stays open for the process; the text one (127 MB) is opened on the first search and freed when the tab closes.
object ClipSessions {
  private val env: OrtEnvironment by lazy { OrtEnvironment.getEnvironment() }
  private var image: OrtSession? = null
  private var text: OrtSession? = null

  @Synchronized fun image(ctx: Context): OrtSession = image ?: open(ctx, ClipModels.VISION, 2).also { image = it }

  @Synchronized fun text(ctx: Context): OrtSession = text ?: open(ctx, ClipModels.TEXT, 1).also { text = it }

  @Synchronized fun releaseText() {
    text?.close()
    text = null
  }

  fun embedImage(s: OrtSession, tensor: FloatArray): FloatArray =
    OnnxTensor.createTensor(env, FloatBuffer.wrap(tensor), longArrayOf(1, 3, 224, 224)).use { input ->
      s.run(mapOf("pixel_values" to input)).use { embeds(it, "image_embeds") }
    }

  fun embedText(s: OrtSession, ids: IntArray): FloatArray {
    val longs = LongBuffer.wrap(LongArray(ids.size) { ids[it].toLong() })
    return OnnxTensor.createTensor(env, longs, longArrayOf(1, ids.size.toLong())).use { input ->
      s.run(mapOf("input_ids" to input)).use { embeds(it, "text_embeds") }
    }
  }

  private fun embeds(out: OrtSession.Result, name: String): FloatArray {
    val buf = (out.get(name).get() as OnnxTensor).floatBuffer
    return FloatArray(buf.remaining()).also { buf.get(it) }
  }

  private fun open(ctx: Context, m: ModelFile, threads: Int): OrtSession =
    OrtSession.SessionOptions().use { opts ->
      opts.setIntraOpNumThreads(threads)
      env.createSession(File(File(ctx.filesDir, "models"), m.name).path, opts)
    }
}
