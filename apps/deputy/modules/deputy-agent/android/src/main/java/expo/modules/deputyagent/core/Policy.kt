package expo.modules.deputyagent.core

enum class TrustLevel { BLOCKED, READ_ONLY, STANDARD }

sealed interface Verdict {
  data object Allow : Verdict
  data class Confirm(val action: String, val target: String?) : Verdict
  data class Deny(val reason: String) : Verdict
}

/** The native gate: PRD safety rules 1–4 and 8 in SPEC §8.2's order, first match wins. */
class Policy(
  private val trust: (pkg: String) -> TrustLevel,
  private val allowedApps: Set<String>?,
  val self: String,
) {
  fun preObserve(pkg: String): Boolean = pkg != self && trust(pkg) != TrustLevel.BLOCKED

  fun check(action: Action, target: NodeRef?, screen: ScreenContext, modelFlag: Boolean): Verdict {
    if (action is Action.TapAt && screen.unread.any { action.x in it.left..it.right && action.y in it.top..it.bottom }) {
      return Verdict.Deny("That point is on the keyboard or a system window, which Deputy doesn't read. Type with type_text, or press back to close it.")
    }
    val pkg = when (action) {
      is Action.OpenApp -> action.pkg
      is Action.OpenLink -> action.handler
      is Action.Press, is Action.Wait, Action.Look -> null
      else -> target?.pkg ?: screen.pkg
    }
    if (pkg == self || (pkg == screen.pkg && changesDeputysAccess(screen, target))) {
      return Verdict.Deny("Deputy can't act on its own app or on the settings that control its access.")
    }
    if (pkg != null && trust(pkg) == TrustLevel.BLOCKED) return Verdict.Deny("This app is blocked for Deputy.")
    if (pkg != null && allowedApps != null && pkg !in allowedApps) {
      return Verdict.Deny("This task may only use these apps: ${allowedApps.joinToString()}.")
    }
    if (action is Action.OpenLink) {
      if (allowedApps != null) return Verdict.Deny("This task may only use its listed apps, so it can't open links.")
      if (action.url.substringBefore(':').lowercase() !in SCHEMES) {
        return Verdict.Deny("Deputy only opens https, http, tel, sms, mailto and geo links.")
      }
    }
    if ((action is Action.Tap || action is Action.LongPress || action is Action.TypeText) && target == null) {
      return Verdict.Deny("That element isn't on the latest screen. Use an index from the latest screen.")
    }
    if (action is Action.TypeText && target?.password == true) return Verdict.Deny("Deputy never types into password fields.")
    return if (pkg != null && trust(pkg) == TrustLevel.READ_ONLY) readOnly(action, target, modelFlag) else standard(action, target, screen, modelFlag)
  }

  private fun readOnly(action: Action, target: NodeRef?, modelFlag: Boolean): Verdict {
    val looks = action is Action.Scroll || action is Action.Swipe || action is Action.Press ||
      action is Action.Wait || action is Action.Look || action is Action.OpenApp || action is Action.OpenLink
    val safeTap = (action is Action.Tap || action is Action.TapAt) && target?.label != null && VerbMatcher.match(target) == null
    return if (!modelFlag && (looks || safeTap)) Verdict.Allow
    else Verdict.Deny("This app is read-only for Deputy, so it can look but not change anything. To allow this, set the app to standard on Deputy's Apps screen.")
  }

  private fun standard(action: Action, target: NodeRef?, screen: ScreenContext, modelFlag: Boolean): Verdict {
    if (action is Action.OpenLink && action.url.substringBefore(':').lowercase() in WEB) return Verdict.Confirm("Open link", action.url)
    val changes = action is Action.Tap || action is Action.TapAt || action is Action.LongPress || action is Action.TypeText
    val enter = action is Action.TypeText && action.pressEnter
    val risky = changes && (enter || (target != null && VerbMatcher.match(target) != null) || isSensitive(screen))
    return if (modelFlag || risky) Verdict.Confirm(name(action), target?.label) else Verdict.Allow
  }

  private fun name(action: Action) = when (action) {
    is Action.TypeText -> if (action.pressEnter) "Type and press Enter" else "Type"
    is Action.LongPress -> "Long-press"
    is Action.Tap, is Action.TapAt -> "Tap"
    else -> action::class.simpleName.orEmpty()
  }

  private fun changesDeputysAccess(s: ScreenContext, target: NodeRef?) =
    ((s.pkg in SETTINGS || s.pkg in PERMISSION_DIALOGS) && s.showsSelf) ||
      (s.pkg in SETTINGS && listOf(s.title, target?.label).any { t -> SELF_PAGES.any { t.orEmpty().contains(it, ignoreCase = true) } })

  // The shade's notifications all belong to System UI, whatever app sent them, so any tap there is asked first.
  private fun isSensitive(s: ScreenContext) = s.pkg in PERMISSION_DIALOGS || s.pkg in INSTALLERS || s.pkg == SYSTEM_UI ||
    (s.pkg in SETTINGS && SECURITY_PAGES.any { s.title.orEmpty().contains(it, ignoreCase = true) })

  private companion object {
    val SCHEMES = setOf("https", "http", "tel", "sms", "smsto", "mailto", "geo")
    val WEB = setOf("https", "http")
    // shortcut: packages and titles cover AOSP and HyperOS as far as known; extend them from the S4 dumps.
    val SETTINGS = setOf("com.android.settings", "com.android.settings.intelligence", "com.miui.securitycenter")
    val PERMISSION_DIALOGS = setOf("com.android.permissioncontroller", "com.google.android.permissioncontroller")
    val INSTALLERS = setOf("com.android.packageinstaller", "com.google.android.packageinstaller", "com.miui.packageinstaller")
    val SELF_PAGES = listOf("accessibility", "special app access", "special access")
    val SECURITY_PAGES = listOf("security", "privacy", "password", "lock", "biometric", "fingerprint", "face", "permission", "device admin", "unknown apps", "encryption", "credential")
  }
}
