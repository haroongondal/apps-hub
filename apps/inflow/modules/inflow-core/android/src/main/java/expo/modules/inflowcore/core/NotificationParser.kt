package expo.modules.inflowcore.core

import java.security.MessageDigest

object NotificationParser {
  const val YOU = "You"

  private val DELETED = listOf(
    "This message was deleted",
    "You deleted this message",
    "یہ پیغام حذف کر دیا گیا تھا",
  )

  fun parse(raw: RawNotification, ownPkg: String, chats: ChatDirectory? = null): List<Capture> {
    if (raw.pkg == ownPkg || raw.ongoing || raw.groupSummary) return emptyList()
    if (raw.messages.isEmpty() && raw.title.isNullOrBlank() && raw.text.isNullOrBlank() &&
      raw.bigText.isNullOrBlank() && raw.textLines.all { it.isBlank() }
    ) return emptyList()

    return if (raw.messages.isNotEmpty()) fromMessages(raw, chats) else fromSingle(raw)
  }

  private fun isOwn(m: RawMessage) = m.own || m.sender == null || m.sender.equals(YOU, ignoreCase = true)

  // R36: a group is keyed by its title, a 1:1 chat by the contact's name. The title cannot be trusted for 1:1: WhatsApp shows "You" after a reply.
  private fun fromMessages(raw: RawNotification, chats: ChatDirectory?): List<Capture> {
    val groupTitle = raw.conversationTitle?.takeIf { it.isNotBlank() }
    val tag = (raw.chatTag ?: raw.shortcutId)?.let { "${raw.pkg}|$it" }   // a tag is only unique within one app
    val conversation = if (raw.isGroupConversation || groupTitle != null) {
      groupTitle ?: raw.title
    } else {
      val contact = raw.messages.firstOrNull { !isOwn(it) }?.sender?.takeIf { it.isNotBlank() }
      if (contact != null && tag != null) chats?.learn(tag, contact)
      contact
        ?: raw.title?.takeIf { it.isNotBlank() && !it.equals(YOU, ignoreCase = true) }
        ?: tag?.let { chats?.nameFor(it) }
        ?: raw.title
    }
    val conversationKey = conversation?.let { senderKey(raw.pkg, it) }
    // A photo sent without a caption has no text: it is kept for its file, with an empty text.
    val shown = raw.messages.filter { it.text.isNotBlank() || it.media != null }
    // A BigPicture belongs to the newest message that has no file of its own.
    val pictureOn = shown.lastOrNull { it.media == null }.takeIf { raw.picture != null }
    return shown.map { m ->
      val sender = if (isOwn(m)) YOU else m.sender!!
      Capture(
        pkg = raw.pkg, appLabel = raw.appLabel,
        sender = sender, senderKey = senderKey(raw.pkg, sender),
        conversation = conversation, conversationKey = conversationKey,
        title = raw.title, text = m.text, postedAt = m.time,
        hash = messageHash(raw.pkg, conversationKey, sender, m.time, m.text),
        deletedPlaceholder = isDeletedPlaceholder(m.text),
        media = m.media ?: raw.picture.takeIf { m === pictureOn },
      )
    }
  }

  /** The item hash of a message; LegacyRepair recomputes it with the same formula. */
  fun messageHash(pkg: String, conversationKey: String?, sender: String, time: Long, text: String): String =
    sha256Hex(listOf(pkg, conversationKey ?: "", sender, time.toString(), text))

  private fun fromSingle(raw: RawNotification): List<Capture> {
    val text = raw.bigText ?: raw.text ?: raw.textLines.joinToString("\n")
    if (text.isBlank() && raw.picture == null) return emptyList()
    val sender = raw.title
    return listOf(
      Capture(
        pkg = raw.pkg, appLabel = raw.appLabel,
        sender = sender, senderKey = sender?.let { senderKey(raw.pkg, it) },
        conversation = null, conversationKey = null,
        title = raw.title, text = text, postedAt = raw.postTime,
        hash = sha256Hex(listOf(raw.pkg, raw.key, raw.title ?: "", text)),
        deletedPlaceholder = isDeletedPlaceholder(text),
        media = raw.picture,
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
