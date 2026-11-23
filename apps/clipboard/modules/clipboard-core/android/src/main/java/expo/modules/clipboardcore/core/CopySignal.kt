package expo.modules.clipboardcore.core

object CopySignal {
  // AccessibilityEvent constants, copied so JVM tests need no Android classes.
  const val VIEW_CLICKED = 0x1
  const val WINDOW_STATE_CHANGED = 0x20
  const val NOTIFICATION_STATE_CHANGED = 0x40
  const val ANNOUNCEMENT = 0x4000

  private val COPY_WORD = Regex("""\bcop(y|ied)\b""", RegexOption.IGNORE_CASE)
  // Windows that are never the app the user copied from.
  val SYSTEM = setOf("android", "com.android.systemui", "com.google.android.inputmethod.latin")

  fun isCopy(type: Int, pkg: String?, text: String, ownPkg: String): Boolean {
    if (pkg == ownPkg) return false
    // Never a window that merely lists Copy: the grab closes the toolbar, it reopens, and we loop (DESIGN.md §4).
    return when (type) {
      VIEW_CLICKED, NOTIFICATION_STATE_CHANGED, ANNOUNCEMENT -> COPY_WORD.containsMatchIn(text)
      else -> false
    }
  }

  // A click or an app's own "Copied" toast names the app; a system toast or announcement falls back to the last app window.
  fun source(type: Int, pkg: String?, foreground: String?): String? = when {
    type == VIEW_CLICKED -> pkg
    pkg != null && pkg !in SYSTEM -> pkg
    else -> foreground
  }
}
