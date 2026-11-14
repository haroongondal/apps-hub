package expo.modules.clipboardcore.core

enum class ClipKind(val id: String) {
  TEXT("text"), SECRET("secret"), CODE("code"), IMAGE("image"), FILE("file");

  // Never stored readable; sealing them comes in Phase 3 (DESIGN.md §5).
  val hidden: Boolean get() = this == SECRET || this == CODE

  companion object {
    private val CODE_TEXT = Regex("""^\s*\d{4,8}\s*$""")

    fun of(sensitive: Boolean, text: String?, uriMime: String?): ClipKind? = when {
      sensitive -> SECRET
      text != null && CODE_TEXT.matches(text) -> CODE
      text != null -> TEXT
      uriMime == null -> null
      uriMime.startsWith("image/") -> IMAGE
      else -> FILE
    }
  }
}
