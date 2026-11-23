package expo.modules.notchisland.core

/** True when [enabled], Settings.Secure "enabled_notification_listeners" (a ':'-separated list of flattened component names), holds [component] exactly. */
fun listenerEnabled(enabled: String?, component: String): Boolean =
  enabled?.split(':')?.contains(component) == true

/** The same check for "enabled_accessibility_services", which may hold the short form "pkg/.Rest" when the class sits under the package. */
fun serviceEnabled(enabled: String?, pkg: String, cls: String): Boolean {
  val short = if (cls.startsWith("$pkg.")) "$pkg/${cls.removePrefix(pkg)}" else null
  return enabled?.split(':')?.any { it == "$pkg/$cls" || it == short } == true
}
