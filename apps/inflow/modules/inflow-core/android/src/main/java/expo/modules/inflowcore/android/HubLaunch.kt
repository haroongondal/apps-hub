package expo.modules.inflowcore.android

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import expo.modules.inflowcore.applink.AppLinkTarget
import expo.modules.inflowcore.applink.SiblingPackages

/**
 * Opens the Store or AI hub from the "Install AI hub", "Allow Inflow in AI hub" and "Add a key in AI hub" buttons. The sender rule: the intent is explicit and the app
 * Android resolves must be the expected package with our signature, else nothing opens. The Store has no page link for one app, so it opens on its own list.
 */
object HubLaunch {
  const val STORE = "com.haroon.store"

  // The Store is not in SiblingPackages (AppLinkTarget.decide refuses it), so the same two checks live here: the right package and our signature.
  fun storeTrusted(resolvedPackage: String?, signaturesMatch: Boolean): Boolean = resolvedPackage == STORE && signaturesMatch

  fun openStore(ctx: Context): Boolean = runCatching {
    val intent = ctx.packageManager.getLaunchIntentForPackage(STORE) ?: return false
    val signed = ctx.packageManager.checkSignatures(ctx.packageName, STORE) == PackageManager.SIGNATURE_MATCH
    storeTrusted(intent.component?.packageName, signed) && start(ctx, intent)
  }.getOrDefault(false)

  fun openAiHub(ctx: Context): Boolean = runCatching {
    val intent = ctx.packageManager.getLaunchIntentForPackage(SiblingPackages.AI_HUB) ?: return false
    AppLinkTarget.trustedActivity(ctx, intent, requireLinkPermission = false) && start(ctx, intent)
  }.getOrDefault(false)

  private fun start(ctx: Context, intent: Intent): Boolean {
    ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    return true
  }
}
