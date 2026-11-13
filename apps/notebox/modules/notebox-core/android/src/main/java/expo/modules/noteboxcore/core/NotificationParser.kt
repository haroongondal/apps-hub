package expo.modules.noteboxcore.core

import java.security.MessageDigest

object NotificationParser {
  private val DELETED = listOf(
    "This message was deleted",
    "You deleted this message",
    "یہ پیغام حذف کر دیا گیا تھا",
  )

  fun parse(raw: RawNotification, ownPkg: String): List<Capture> {
    if (raw.pkg == ownPkg || raw.ongoing || raw.groupSummary) return emptyList()
    if (raw.messages.isEmpty() && raw.title.isNullOrBlank() && raw.text.isNullOrBlank() &&
      raw.bigText.isNullOrBlank() && raw.textLines.all { it.isBlank() }
    ) return emptyList()

    return if (raw.messages.isNotEmpty()) fromMessages(raw) else fromSingle(raw)
  }

  private fun fromMessages(raw: RawNotification): List<Capture> {
    val conversation = raw.conversationTitle?.takeIf { it.isNotBlank() } ?: raw.title
    val conversationKey = conversation?.let { senderKey(raw.pkg, it) }
    return raw.messages.filter { it.text.isNotBlank() }.map { m ->
      val sender = m.sender ?: "You"
      Capture(
        pkg = raw.pkg, appLabel = raw.appLabel,
        sender = sender, senderKey = senderKey(raw.pkg, sender),
        conversation = conversation, conversationKey = conversationKey,
        title = raw.title, text = m.text, postedAt = m.time,
        hash = sha256Hex(listOf(raw.pkg, conversationKey ?: "", sender, m.time.toString(), m.text)),
        deletedPlaceholder = isDeletedPlaceholder(m.text),
      )
    }
  }

  private fun fromSingle(raw: RawNotification): List<Capture> {
    val text = raw.bigText ?: raw.text ?: raw.textLines.joinToString("\n")
    if (text.isBlank()) return emptyList()
    val sender = raw.title
    return listOf(
      Capture(
        pkg = raw.pkg, appLabel = raw.appLabel,
        sender = sender, senderKey = sender?.let { senderKey(raw.pkg, it) },
        conversation = null, conversationKey = null,
        title = raw.title, text = text, postedAt = raw.postTime,
        hash = sha256Hex(listOf(raw.pkg, raw.key, raw.title ?: "", text)),
        deletedPlaceholder = isDeletedPlaceholder(text),
      ),
    )
  }

  private fun isDeletedPlaceholder(text: String): Boolean {
    val t = text.trim()
    return DELETED.any { it.equals(t, ignoreCase = true) }
  }

  private fun sha256Hex(parts: List<String>): String {
    val digest = MessageDigest.getInstance("SHA-256")
      .digest(parts.joinToString("\u0000").toByteArray(Charsets.UTF_8))
    return digest.joinToString("") { "%02x".format(it) }
  }
}
