package expo.modules.textocr

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.util.Base64
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayInputStream

class TextOcrModule : Module() {
  private val context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  override fun definition() = ModuleDefinition {
    Name("TextOcr")

    AsyncFunction("recognizeBase64") { base64: String ->
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      recognize(context) { ByteArrayInputStream(bytes) }
    }

    AsyncFunction("recognizeFile") { uri: String ->
      val u = Uri.parse(uri)
      recognize(context) { context.contentResolver.openInputStream(u) }
    }

    AsyncFunction("copy") { text: String ->
      val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      clipboard.setPrimaryClip(ClipData.newPlainText("text", text))
    }.runOnQueue(Queues.MAIN)
  }
}
