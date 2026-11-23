package expo.modules.aihubclient

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.os.RemoteException
import android.os.TransactionTooLargeException
import expo.modules.aihubclient.core.AiHubException
import expo.modules.aihubclient.core.HubLimits
import expo.modules.aihubclient.core.Kinds
import expo.modules.aihubcore.IAiHub
import expo.modules.aihubcore.IAiHubCallback
import java.io.File
import java.io.FileNotFoundException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull

// Binds AI hub for each call and unbinds when it ends, so an idle app never keeps the hub alive. Never logs a request or a reply.
class AiHubClient(
  context: Context,
  private val connectTimeoutMs: Long = 10_000,
  private val replyTimeoutMs: Long = 5 * 60_000,
) {
  private val context = context.applicationContext

  suspend fun apiVersion(): Int = withHub { hub, _ -> call { hub.apiVersion() } }

  suspend fun available(need: Int = 1): Boolean = try {
    apiVersion() >= need
  } catch (e: AiHubException) {
    false
  }

  suspend fun submit(requestJson: String, attachment: File? = null): String {
    val req = HubLimits.check(requestJson, attachment?.let { if (it.isFile) it.length() else -1L })
    return withHub { hub, link ->
      if (call { hub.apiVersion() } < req.apiVersion) {
        throw AiHubException(Kinds.VERSION, "This needs a newer AI hub. Update AI hub from the Store.")
      }
      val pfd = try {
        attachment?.let { ParcelFileDescriptor.open(it, ParcelFileDescriptor.MODE_READ_ONLY) }
      } catch (e: FileNotFoundException) {
        throw AiHubException(Kinds.INVALID, "The file to send can't be opened.")
      }
      try {
        call { hub.submit(requestJson, pfd, link.callback) }
      } finally {
        runCatching { pfd?.close() }
      }
      try {
        withTimeout(replyTimeoutMs) { link.reply.await() }
      } catch (e: TimeoutCancellationException) {
        cancelAtHub(hub, req.requestId)
        throw AiHubException(Kinds.TIMEOUT, "AI hub took too long to answer. Try again.")
      } catch (e: CancellationException) {
        cancelAtHub(hub, req.requestId)
        throw e
      }
    }
  }

  private suspend fun cancelAtHub(hub: IAiHub, requestId: String) {
    withContext(NonCancellable + Dispatchers.IO) { runCatching { hub.cancel(requestId) } }
  }

  private suspend fun <T> withHub(block: suspend (IAiHub, Link) -> T): T {
    val link = Link()
    val intent = Intent(ACTION).setPackage(PACKAGE)
    val bound = try {
      context.bindService(intent, link, Context.BIND_AUTO_CREATE)
    } catch (e: SecurityException) {
      throw AiHubException(Kinds.NOT_ALLOWED, "This app isn't signed like AI hub, so AI hub won't serve it.")
    }
    try {
      if (!bound) throw AiHubException(Kinds.HUB_MISSING, "AI hub isn't installed. Install it from the Store, or use this app's own key.")
      val hub = withTimeoutOrNull(connectTimeoutMs) { link.hub.await() }
        ?: throw AiHubException(Kinds.HUB_MISSING, "AI hub didn't answer. Try again, or use this app's own key.")
      return block(hub, link)
    } finally {
      // Android asks for unbindService even when bindService returned false.
      runCatching { context.unbindService(link) }
    }
  }

  private suspend fun <T> call(block: () -> T): T = withContext(Dispatchers.IO) {
    try {
      block()
    } catch (e: SecurityException) {
      throw AiHubException(Kinds.NOT_ALLOWED, e.message ?: "AI hub refused this app.")
    } catch (e: TransactionTooLargeException) {
      throw AiHubException(Kinds.TOO_LARGE, "The request is too big to hand to AI hub. Send less text.")
    } catch (e: RemoteException) {
      throw AiHubException(Kinds.HUB_MISSING, GONE)
    }
  }

  private class Link : ServiceConnection {
    val hub = CompletableDeferred<IAiHub>()
    val reply = CompletableDeferred<String>()

    val callback = object : IAiHubCallback.Stub() {
      override fun onResult(requestId: String?, resultJson: String?) {
        reply.complete(resultJson.orEmpty())
      }

      override fun onError(requestId: String?, kind: String?, message: String?) {
        reply.completeExceptionally(AiHubException(Kinds.fromHub(kind), message?.takeIf { it.isNotBlank() } ?: "AI hub couldn't finish the request."))
      }
    }

    override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
      if (service == null) gone() else hub.complete(IAiHub.Stub.asInterface(service))
    }

    override fun onServiceDisconnected(name: ComponentName?) = gone()

    override fun onBindingDied(name: ComponentName?) = gone()

    override fun onNullBinding(name: ComponentName?) = gone()

    private fun gone() {
      val e = AiHubException(Kinds.HUB_MISSING, GONE)
      hub.completeExceptionally(e)
      reply.completeExceptionally(e)
    }
  }

  companion object {
    const val ACTION = "com.haroon.aihub.BIND"
    const val PACKAGE = "com.haroon.aihub"
    private const val GONE = "AI hub stopped. Try again, or use this app's own key."
  }
}
