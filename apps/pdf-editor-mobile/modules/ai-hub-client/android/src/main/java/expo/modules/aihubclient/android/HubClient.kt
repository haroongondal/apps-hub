package expo.modules.aihubclient.android

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.os.RemoteException
import expo.modules.aihubcore.IAiHub
import expo.modules.aihubcore.IAiHubCallback
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class HubError(val kind: String, message: String) : Exception(message)

// One bind per call: simple, and a hub that was killed in between never leaves a dead binder behind.
object HubClient {
  private const val HUB = "com.haroon.aihub"
  private const val ACTION = "com.haroon.aihub.BIND"
  private const val BIND_WAIT_S = 15L
  private const val CALL_WAIT_S = 150L // the hub tries every key and both services; the app's CV call allows less

  fun status(context: Context): String = withHub(context) { it.status() }

  fun submit(context: Context, requestJson: String): String = withHub(context) { hub ->
    val done = CountDownLatch(1)
    val result = AtomicReference<String?>()
    val error = AtomicReference<HubError?>()
    val callback = object : IAiHubCallback.Stub() {
      override fun onResult(requestId: String?, resultJson: String?) {
        result.set(resultJson)
        done.countDown()
      }

      override fun onError(requestId: String?, kind: String?, message: String?) {
        error.set(HubError(kind ?: "failed", message ?: "AI hub could not answer."))
        done.countDown()
      }
    }
    try {
      hub.submit(requestJson, null, callback)
    } catch (e: SecurityException) {
      throw HubError("denied", e.message ?: "AI hub refused this app.")
    }
    if (!done.await(CALL_WAIT_S, TimeUnit.SECONDS)) throw HubError("timeout", "AI hub took too long to answer.")
    error.get()?.let { throw it }
    result.get() ?: throw HubError("bad_reply", "AI hub sent an empty answer.")
  }

  private fun <T> withHub(context: Context, block: (IAiHub) -> T): T {
    val connected = CountDownLatch(1)
    val service = AtomicReference<IAiHub?>()
    val connection = object : ServiceConnection {
      override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
        service.set(IAiHub.Stub.asInterface(binder))
        connected.countDown()
      }

      override fun onServiceDisconnected(name: ComponentName?) {}

      override fun onNullBinding(name: ComponentName?) = connected.countDown()
    }
    val bound = try {
      context.bindService(Intent(ACTION).setPackage(HUB), connection, Context.BIND_AUTO_CREATE)
    } catch (e: SecurityException) {
      throw HubError("denied", "This app is not allowed to use AI hub. Both must be signed with the same key.")
    }
    try {
      if (!bound) throw HubError("hub_missing", "AI hub is not installed. Install it from the Store.")
      if (!connected.await(BIND_WAIT_S, TimeUnit.SECONDS)) throw HubError("hub_unreachable", "AI hub did not start. Open AI hub once, then try again.")
      val hub = service.get() ?: throw HubError("hub_unreachable", "AI hub did not start. Open AI hub once, then try again.")
      return try {
        block(hub)
      } catch (e: RemoteException) {
        throw HubError("hub_died", "AI hub stopped while answering. Try again.")
      }
    } finally {
      context.unbindService(connection)
    }
  }
}
