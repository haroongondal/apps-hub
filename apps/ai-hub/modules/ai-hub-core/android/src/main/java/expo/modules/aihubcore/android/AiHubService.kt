package expo.modules.aihubcore.android

import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.os.RemoteException
import expo.modules.aihubcore.IAiHub
import expo.modules.aihubcore.IAiHubCallback
import expo.modules.aihubcore.core.ApiVersion
import expo.modules.aihubcore.core.Decision
import expo.modules.aihubcore.core.Request

// The signature permission guards the bind; every call still checks its caller (defence in depth).
class AiHubService : Service() {
  private lateinit var worker: Worker

  override fun onCreate() {
    super.onCreate()
    worker = Worker(applicationContext)
  }

  override fun onDestroy() {
    worker.shutdown()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder = binder

  private fun caller(): Caller = Callers.identify(this, Binder.getCallingUid(), worker.switches()).also { c ->
    (c.decision as? Decision.Deny)?.ask?.let(worker::notePending)
  }

  private fun allowed(): Caller {
    val c = caller()
    (c.decision as? Decision.Deny)?.let { throw SecurityException(it.reason) }
    return c
  }

  private val binder = object : IAiHub.Stub() {
    override fun apiVersion(): Int {
      allowed()
      return ApiVersion.CURRENT
    }

    override fun submit(requestJson: String?, attachment: ParcelFileDescriptor?, callback: IAiHubCallback?) {
      if (callback == null) {
        runCatching { attachment?.close() }
        throw IllegalArgumentException("submit needs a callback.")
      }
      val c = caller()
      val deny = c.decision as? Decision.Deny
      if (deny == null) return worker.submit(c, requestJson, attachment, callback)
      runCatching { attachment?.close() }
      try {
        callback.onError(Request.idOf(requestJson), "denied", deny.reason)
      } catch (e: RemoteException) {
        return
      }
    }

    override fun cancel(requestId: String?) = worker.cancel(allowed(), requestId)

    override fun status(): String {
      allowed()
      return worker.status()
    }
  }
}
