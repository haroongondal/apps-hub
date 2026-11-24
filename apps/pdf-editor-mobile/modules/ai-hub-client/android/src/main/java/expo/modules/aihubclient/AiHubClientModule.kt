package expo.modules.aihubclient

import android.content.Context
import expo.modules.aihubclient.android.HubClient
import expo.modules.aihubclient.android.HubError
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.concurrent.thread

class AiHubClientModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AiHubClient")

    AsyncFunction("submit") { requestJson: String, promise: Promise -> run(promise) { HubClient.submit(it, requestJson) } }

    AsyncFunction("status") { promise: Promise -> run(promise) { HubClient.status(it) } }
  }

  // A call can wait minutes, so it gets its own thread instead of holding the module's queue.
  private fun run(promise: Promise, call: (Context) -> String) {
    val context = appContext.reactContext
    if (context == null) {
      promise.reject("hub_unreachable", "The app isn't running", null)
      return
    }
    thread(name = "ai-hub-call") {
      try {
        promise.resolve(call(context))
      } catch (e: HubError) {
        promise.reject(e.kind, e.message, e)
      } catch (e: Exception) {
        promise.reject("failed", e.message ?: "AI hub call failed", e)
      }
    }
  }
}
