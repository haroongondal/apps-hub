package expo.modules.haloengine.applink

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

// Canonical copy-in (only `package` changes). Before reading a sibling's provider or sending it an intent, check that the
// app Android resolved to is that sibling and is signed with our key: another app can take a package's authority or name first.
object AppLinkTarget {
  const val LINK_PERMISSION = "com.haroon.permission.AUTOPILOT"

  enum class Reason { UNKNOWN_SIBLING, WRONG_PACKAGE, SIGNATURE_MISMATCH }

  sealed interface Decision {
    data object Trusted : Decision
    data object NotInstalled : Decision
    data class Spoofed(val reason: Reason) : Decision
  }

  fun decide(expectedPackage: String, resolvedPackage: String?, signaturesMatch: Boolean): Decision = when {
    expectedPackage !in SiblingPackages.ALL.values -> Decision.Spoofed(Reason.UNKNOWN_SIBLING)
    resolvedPackage.isNullOrEmpty() -> Decision.NotInstalled
    resolvedPackage != expectedPackage -> Decision.Spoofed(Reason.WRONG_PACKAGE)
    !signaturesMatch -> Decision.Spoofed(Reason.SIGNATURE_MISMATCH)
    else -> Decision.Trusted
  }

  fun trustedProvider(context: Context, authority: String, expectedPackage: String): Boolean = runCatching {
    val resolved = context.packageManager.resolveContentProvider(authority, 0)?.packageName
    trusted(context, expectedPackage, resolved)
  }.getOrDefault(false)

  fun trustedActivity(context: Context, intent: Intent, requireLinkPermission: Boolean = true): Boolean = runCatching {
    val found = context.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY).map { it.activityInfo }
    val permissionOk = !requireLinkPermission || found.all { it.permission == LINK_PERMISSION }
    permissionOk && resolvesInto(context, intent, found.map { it.packageName })
  }.getOrDefault(false)

  fun trustedReceiver(context: Context, intent: Intent): Boolean = runCatching {
    val found = context.packageManager.queryBroadcastReceivers(intent, 0).map { it.activityInfo }
    found.all { it.permission == LINK_PERMISSION } && resolvesInto(context, intent, found.map { it.packageName })
  }.getOrDefault(false)

  private fun resolvesInto(context: Context, intent: Intent, packages: List<String>): Boolean {
    val component = intent.component?.packageName
    val pkg = intent.`package`
    if (component != null && pkg != null && component != pkg) return false
    val expected = component ?: pkg ?: return false
    val resolved = packages.firstOrNull { it != expected } ?: packages.firstOrNull()
    return trusted(context, expected, resolved)
  }

  private fun trusted(context: Context, expected: String, resolved: String?): Boolean {
    val signaturesMatch = context.packageManager.checkSignatures(context.packageName, expected) == PackageManager.SIGNATURE_MATCH
    return decide(expected, resolved, signaturesMatch) == Decision.Trusted
  }
}

object SiblingPackages {
  const val HOMENET = "app.netlens"
  const val TUNNELWALL = "com.opentunnel.open_tunnel_vpn"
  const val DEPUTY = "com.haroon.deputy"
  const val STRONGROOM = "com.haroon.strongroom"
  const val INFLOW = "com.haroon.inflow"
  const val NEXUS = "com.haroon.pdfeditor"
  const val CLIPBOARD = "com.haroon.clipboard"
  const val HALO = "com.haroon.halo"
  const val DESIGN_EDITOR = "com.haroon.designeditor"
  const val AI_HUB = "com.haroon.aihub"

  val ALL: Map<String, String> = mapOf(
    "netlens" to HOMENET,
    "open-tunnel" to TUNNELWALL,
    "deputy" to DEPUTY,
    "strongroom" to STRONGROOM,
    "inflow" to INFLOW,
    "pdf-editor" to NEXUS,
    "clipboard" to CLIPBOARD,
    "halo" to HALO,
    "design-editor" to DESIGN_EDITOR,
    "ai-hub" to AI_HUB,
  )
}
