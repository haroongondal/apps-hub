package expo.modules.aihubclient.core

data class HubService(val pkg: String, val name: String, val permission: String?, val exported: Boolean)

// A package named com.haroon.aihub is trusted only when it is signed like this app and exposes exactly the one guarded service,
// so an app that squatted the name before the real hub was installed never receives a prompt or an attachment.
object HubTrust {
  const val PACKAGE = "com.haroon.aihub"
  const val PERMISSION = "com.haroon.permission.AI_HUB"

  fun problem(installed: Boolean, sameSigner: Boolean, services: List<HubService>): AiHubException? {
    if (!installed) return AiHubException(Kinds.HUB_MISSING, "AI hub isn't installed. Install it from the Store, or use this app's own key.")
    if (!sameSigner) return untrusted()
    if (services.isEmpty()) return AiHubException(Kinds.HUB_MISSING, "This AI hub has no AI service. Update AI hub from the Store, or use this app's own key.")
    val s = services.singleOrNull() ?: return untrusted()
    return if (s.pkg == PACKAGE && s.permission == PERMISSION && s.exported) null else untrusted()
  }

  fun connectedIsTrusted(expected: HubService, connectedPkg: String?, connectedName: String?, sameSigner: Boolean): Boolean =
    sameSigner && connectedPkg == expected.pkg && connectedName == expected.name

  fun untrusted() = AiHubException(Kinds.NOT_ALLOWED, "The installed AI hub isn't signed by the same owner as this app, so this app won't send it anything.")
}
