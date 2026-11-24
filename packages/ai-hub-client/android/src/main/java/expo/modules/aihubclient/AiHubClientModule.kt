package expo.modules.aihubclient

import expo.modules.aihubclient.core.AiHubException
import expo.modules.aihubclient.core.HubLimits
import expo.modules.aihubclient.core.Kinds
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.URI
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

@OptIn(ExperimentalCoroutinesApi::class)
class AiHubClientModule : Module() {
  private val moduleScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private val running = HashMap<String, Job>()
  private val client by lazy { AiHubClient(requireNotNull(appContext.reactContext) { "React context unavailable" }) }

  override fun definition() = ModuleDefinition {
    Name("AiHubClient")

    AsyncFunction("hubVersion") { promise: Promise ->
      moduleScope.launch(start = CoroutineStart.ATOMIC) { settle(promise) { client.apiVersion() } }
    }

    AsyncFunction("submit") { requestJson: String, attachmentPath: String?, promise: Promise ->
      val id = HubLimits.requestIdOf(requestJson)
      if (id == null) {
        promise.reject(Kinds.INVALID, "The requestId must be 1 to 64 letters, digits, - or _.", null)
        return@AsyncFunction
      }
      synchronized(running) {
        if (id in running) {
          promise.reject(Kinds.INVALID, "A request with this id is already running. Use a new requestId.", null)
          return@AsyncFunction
        }
        // ATOMIC: the body runs even if cancel() lands first, so the promise always settles.
        running[id] = moduleScope.launch(start = CoroutineStart.ATOMIC) {
          try {
            settle(promise) { client.submit(requestJson, attachmentPath?.let(::fileOf)) }
          } finally {
            synchronized(running) { running.remove(id) }
          }
        }
      }
    }

    AsyncFunction("cancel") { requestId: String ->
      synchronized(running) { running[requestId] }?.cancel()
    }

    OnDestroy {
      moduleScope.cancel()
    }
  }

  private suspend fun settle(promise: Promise, work: suspend () -> Any) {
    try {
      promise.resolve(work())
    } catch (e: AiHubException) {
      promise.reject(e.kind, e.message, null)
    } catch (e: CancellationException) {
      promise.reject(Kinds.CANCELLED, "The request was cancelled.", null)
    } catch (e: Exception) {
      promise.reject(Kinds.PROVIDER, "AI hub hit an unexpected error. Try again.", null)
    }
  }

  private fun fileOf(path: String): File = try {
    if (path.startsWith("file:")) File(URI(path)) else File(path)
  } catch (e: Exception) {
    throw AiHubException(Kinds.INVALID, "Send the picture or audio as a file path on the phone.")
  }
}
