package expo.modules.nexuslinks

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.nexuslinks.android.LinkReader
import expo.modules.nexuslinks.applink.AppLinkTarget
import expo.modules.nexuslinks.core.Links
import expo.modules.nexuslinks.core.Opens
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

class NexusLinksModule : Module() {
  private val readerLazy = lazy { LinkReader(requireNotNull(appContext.reactContext).applicationContext) }
  // The read waits up to its timeout on this pool, never on Expo's shared async queue.
  private val waiters = Executors.newCachedThreadPool()
  private val pending = AtomicReference<Promise?>(null)

  override fun definition() = ModuleDefinition {
    Name("NexusLinks")

    AsyncFunction("readShare") { id: String, sinceId: Double?, promise: Promise ->
      try {
        waiters.execute {
          promise.resolve(runCatching { readerLazy.value.read(id, sinceId) }.getOrElse { failedRead() })
        }
      } catch (e: Exception) {
        promise.resolve(failedRead())
      }
    }

    // Never context.startActivity with NEW_TASK: the receivers trust only a callingPackage, which Android sets only for a result request from an Activity.
    AsyncFunction("startLink") { action: String, extras: Map<String, Any?>, promise: Promise ->
      val start = when (val plan = Links.plan(action, extras)) {
        is Links.Plan.Answer -> return@AsyncFunction promise.resolve(plan.result.toMap())
        is Links.Plan.Start -> plan
      }
      val activity = appContext.currentActivity
      if (activity == null || activity.isFinishing) return@AsyncFunction promise.resolve(Links.Result(Links.UNAVAILABLE).toMap())
      val intent = intent(start)
      if (!AppLinkTarget.trustedActivity(activity, intent)) return@AsyncFunction promise.resolve(Links.Result(Links.UNAVAILABLE).toMap())
      if (!pending.compareAndSet(null, promise)) return@AsyncFunction promise.resolve(Links.Result(Links.FAILED, "busy").toMap())
      val failed = try {
        activity.startActivityForResult(intent, Links.REQUEST_CODE)
        null
      } catch (_: ActivityNotFoundException) {
        Links.Result(Links.UNAVAILABLE)
      } catch (_: SecurityException) {
        Links.Result(Links.REFUSED)
      } catch (_: Exception) {
        Links.Result(Links.FAILED)
      }
      if (failed != null) pending.getAndSet(null)?.resolve(failed.toMap())
    }.runOnQueue(Queues.MAIN)

    // Opens the Store or AI hub for the owner to install, allow or set up AI. Never an implicit intent: the launch component must be that package, signed like Nexus.
    AsyncFunction("openApp") { app: String, promise: Promise ->
      val pkg = Opens.packageOf(app) ?: return@AsyncFunction promise.resolve(Links.Result(Links.FAILED, "unknown_app").toMap())
      val activity = appContext.currentActivity
      if (activity == null || activity.isFinishing) return@AsyncFunction promise.resolve(Links.Result(Links.UNAVAILABLE).toMap())
      val pm = activity.packageManager
      val launch = pm.getLaunchIntentForPackage(pkg) ?: return@AsyncFunction promise.resolve(Links.Result(Links.UNAVAILABLE).toMap())
      val signed = runCatching { pm.checkSignatures(activity.packageName, pkg) == PackageManager.SIGNATURE_MATCH }.getOrDefault(false)
      if (!Opens.trusted(pkg, launch.component?.packageName, signed)) return@AsyncFunction promise.resolve(Links.Result(Links.UNAVAILABLE).toMap())
      val result = try {
        activity.startActivity(launch)
        Links.Result(Links.DONE)
      } catch (_: ActivityNotFoundException) {
        Links.Result(Links.UNAVAILABLE)
      } catch (_: Exception) {
        Links.Result(Links.FAILED)
      }
      promise.resolve(result.toMap())
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode != Links.REQUEST_CODE) return@OnActivityResult
      val result = Links.result(payload.resultCode == Activity.RESULT_OK, payload.data?.getStringExtra("status"), payload.data?.getStringExtra("code"))
      pending.getAndSet(null)?.resolve(result.toMap())
    }

    OnDestroy {
      pending.getAndSet(null)?.resolve(Links.Result(Links.CANCELLED).toMap())
      waiters.shutdownNow()
      if (readerLazy.isInitialized()) readerLazy.value.close()
    }
  }

  private fun failedRead() = mapOf("status" to "failed", "rows" to emptyList<Any>())

  private fun intent(start: Links.Plan.Start): Intent {
    val intent = Intent(start.action).setPackage(start.pkg)
    for ((key, value) in start.extras) {
      when (value) {
        is String -> intent.putExtra(key, value)
        is Long -> intent.putExtra(key, value)
        is Boolean -> intent.putExtra(key, value)
        is List<*> -> intent.putExtra(key, value.map { it as String }.toTypedArray())
      }
    }
    return intent
  }
}
