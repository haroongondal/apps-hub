package expo.modules.storeinstaller

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val EVENT_INSTALL_STATUS = "onInstallStatus"
private const val EVENT_INSTALL_PROGRESS = "onInstallProgress"

class StoreInstallerModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  override fun definition() = ModuleDefinition {
    Name("StoreInstaller")

    Events(EVENT_INSTALL_STATUS, EVENT_INSTALL_PROGRESS)

    OnCreate { instance = this@StoreInstallerModule }
    OnDestroy { if (instance === this@StoreInstallerModule) instance = null }

    Function("getInstalledVersion") { packageName: String -> Packages.installed(context, packageName) }

    Function("installApk") { url: String, packageName: String, name: String, sha256: String, certSha256: String ->
      InstallWorker.enqueue(context, url, packageName, name, sha256, certSha256)
    }

    AsyncFunction("getActiveInstalls") Coroutine { -> withContext(Dispatchers.IO) { InstallWorker.active(context) } }

    Function("canRequestPackageInstalls") {
      Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()
    }

    Function("openInstallPermissionSettings") {
      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    Function("setCredentials") { apiUrl: String, token: String -> Credentials.save(context, apiUrl, token) }
    Function("getCredentials") {
      Credentials.load(context)?.let { (apiUrl, token) -> mapOf("apiUrl" to apiUrl, "token" to token) }
    }
    Function("clearCredentials") { Credentials.clear(context) }

    Function("scheduleUpdateCheck") { hours: Int -> UpdateCheckWorker.schedule(context, hours) }
    Function("getUpdateCheckHours") { UpdateCheckWorker.hours(context) }
  }

  companion object {
    @Volatile private var instance: StoreInstallerModule? = null

    fun emitInstallStatus(payload: Map<String, Any?>) {
      instance?.sendEvent(EVENT_INSTALL_STATUS, payload)
    }

    fun emitInstallProgress(payload: Map<String, Any?>) {
      instance?.sendEvent(EVENT_INSTALL_PROGRESS, payload)
    }
  }
}
