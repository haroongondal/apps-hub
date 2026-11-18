package expo.modules.notchisland.core

/** True when [enabled], Settings.Secure "enabled_notification_listeners" (a ':'-separated list of flattened component names), holds [component] exactly. */
fun listenerEnabled(enabled: String?, component: String): Boolean =
  enabled?.split(':')?.contains(component) == true
