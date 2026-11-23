package expo.modules.aihubcore.android

import android.content.Context
import android.util.AtomicFile
import java.io.File
import kotlinx.serialization.json.Json

// One AtomicFile per setting: a torn write leaves the old value, and a corrupt file only loses that setting.
class HubStore private constructor(context: Context) {
  private val dir = File(context.filesDir, "aihub-settings").apply { mkdirs() }

  private fun file(name: String): AtomicFile {
    require(NAME.matches(name)) { "Bad setting name" }
    return AtomicFile(File(dir, "$name.json"))
  }

  @Synchronized
  fun get(name: String): String? = try {
    file(name).readFully().toString(Charsets.UTF_8).also { Json.parseToJsonElement(it) }
  } catch (e: Exception) {
    null
  }

  @Synchronized
  fun put(name: String, json: String) {
    val f = file(name)
    val out = f.startWrite()
    try {
      out.write(json.toByteArray(Charsets.UTF_8))
      f.finishWrite(out)
    } catch (e: Exception) {
      f.failWrite(out)
      throw e
    }
  }

  companion object {
    private val NAME = Regex("[a-z0-9_-]{1,64}")

    @Volatile private var shared: HubStore? = null

    fun get(context: Context): HubStore = shared ?: synchronized(this) {
      shared ?: HubStore(context.applicationContext).also { shared = it }
    }
  }
}
