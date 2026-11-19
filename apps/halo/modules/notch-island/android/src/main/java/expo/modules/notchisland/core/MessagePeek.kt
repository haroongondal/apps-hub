package expo.modules.notchisland.core

data class MessageSnapshot(val key: String, val pkg: String, val sender: String, val line: String, val postedAt: Long)

data class MessagePeekSettings(val on: Boolean = false, val apps: List<String> = emptyList())

object MessagePeek {
  const val SHOW_MS = 8_000L
  const val MAX_CHARS = 60
  const val MAX_APPS = 20
  val PACKAGE = Regex("^[a-zA-Z0-9_.]{1,150}$")

  // Messaging apps that may post a message without CATEGORY_MESSAGE ("msg").
  val MESSAGING_PACKAGES = setOf(
    "com.whatsapp", "com.whatsapp.w4b",
    "org.telegram.messenger", "org.telegram.messenger.web", "org.thunderdog.challegram",
    "com.google.android.apps.messaging", "com.android.mms", "com.android.messaging", "com.samsung.android.messaging",
  )

  fun qualifies(pkg: String, ongoing: Boolean, category: String?, groupSummary: Boolean, settings: MessagePeekSettings): Boolean =
    settings.on && pkg in settings.apps && !ongoing && !groupSummary &&
      (category == "msg" || (category == null && pkg in MESSAGING_PACKAGES))

  fun line(text: CharSequence?): String {
    val flat = text?.toString().orEmpty().replace(Regex("\\s+"), " ").trim()
    if (flat.length <= MAX_CHARS) return flat
    var end = MAX_CHARS - 1
    if (Character.isHighSurrogate(flat[end - 1])) end--
    return flat.substring(0, end).trimEnd() + "…"
  }

  fun snapshot(key: String, pkg: String, title: CharSequence?, text: CharSequence?, postedAt: Long): MessageSnapshot? {
    val sender = line(title).ifEmpty { return null }
    return MessageSnapshot(key, pkg, sender, line(text), postedAt)
  }

  // A re-post that says the same thing keeps the first snapshot, so it does not peek again.
  fun next(current: MessageSnapshot?, incoming: MessageSnapshot): MessageSnapshot = when {
    current == null -> incoming
    current.key == incoming.key && current.sender == incoming.sender && current.line == incoming.line -> current
    incoming.postedAt >= current.postedAt -> incoming
    else -> current
  }

  fun remainingMs(m: MessageSnapshot?, settings: MessagePeekSettings, now: Long, seenUntil: Long, callActive: Boolean): Long =
    if (m == null || callActive || !settings.on || m.pkg !in settings.apps || m.postedAt <= seenUntil) 0
    else (m.postedAt + SHOW_MS - now).coerceIn(0, SHOW_MS)
}
