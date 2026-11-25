package expo.modules.deputyagent.android

import android.content.Context
import android.util.Base64
import expo.modules.aihubclient.AiHubClient
import expo.modules.deputyagent.core.HubCall
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The one place Deputy builds the hub client. A screenshot lives in the cache folder only for the length of its call. */
class HubLink(private val ctx: Context) : HubCall {
  override suspend fun submit(requestJson: String, jpegBase64: String?): String {
    val client = AiHubClient(ctx)
    if (jpegBase64 == null) return client.submit(requestJson)
    val file = File(ctx.cacheDir, "$PREFIX${UUID.randomUUID()}.jpg")
    try {
      withContext(Dispatchers.IO) { file.writeBytes(Base64.decode(jpegBase64, Base64.DEFAULT)) }
      return client.submit(requestJson, file)
    } finally {
      file.delete()
    }
  }

  companion object {
    private const val PREFIX = "hub-shot-"

    fun sweep(ctx: Context) {
      ctx.cacheDir.listFiles { f -> f.name.startsWith(PREFIX) }?.forEach { it.delete() }
    }
  }
}
