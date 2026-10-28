package expo.modules.deputyagent.core

object ServiceSetting {
  /** `setting` is Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES: `pkg/class` entries joined by ':', where `/.Class` is relative to `pkg`. */
  fun isEnabled(setting: String?, pkg: String, cls: String): Boolean =
    setting.orEmpty().split(':').any { entry ->
      val parts = entry.split('/', limit = 2)
      parts.size == 2 && parts[0] == pkg && (if (parts[1].startsWith('.')) pkg + parts[1] else parts[1]) == cls
    }
}
