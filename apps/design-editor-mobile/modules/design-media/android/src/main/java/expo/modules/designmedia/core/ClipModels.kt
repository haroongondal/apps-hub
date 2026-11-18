package expo.modules.designmedia.core

import java.io.File
import java.security.MessageDigest

data class ModelFile(val name: String, val url: String, val bytes: Long, val sha256: String)

// The pinned CLIP files the app's JS downloads; Kotlin only verifies and installs them (no network here).
object ClipModels {
  const val REVISION = "6b7c523703ae26e39be4b03774966f8571c7f523"
  private const val BASE = "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/$REVISION/onnx/"

  val VISION = ModelFile(
    "vision_model_quantized.onnx", BASE + "vision_model_quantized.onnx", 89_117_001L,
    "583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299",
  )
  val TEXT = ModelFile(
    "text_model_fp16.onnx", BASE + "text_model_fp16.onnx", 127_339_794L,
    "df587ffbf248bf20d44fa6e16adc5ebc27ead691860e5333dbdaab5fd6bf3f6e",
  )
  val ALL = listOf(VISION, TEXT)

  fun sha256Of(f: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    f.inputStream().use { input ->
      val buf = ByteArray(1 shl 16)
      while (true) {
        val n = input.read(buf)
        if (n < 0) break
        md.update(buf, 0, n)
      }
    }
    return md.digest().joinToString("") { "%02x".format(it) }
  }

  fun isReady(dir: File, m: ModelFile): Boolean = File(dir, m.name).let { it.isFile && it.length() == m.bytes }

  // Hash is checked here once; a bad .part is deleted so it is never reused, and the final name only ever appears whole.
  fun install(dir: File, m: ModelFile): Boolean {
    val part = File(dir, m.name + ".part")
    if (!part.isFile) return false
    val good = part.length() == m.bytes && sha256Of(part) == m.sha256
    if (good && part.renameTo(File(dir, m.name))) return true
    part.delete()
    return false
  }
}
