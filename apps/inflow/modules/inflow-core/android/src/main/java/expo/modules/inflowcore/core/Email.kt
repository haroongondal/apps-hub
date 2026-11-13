package expo.modules.inflowcore.core

import jakarta.mail.Multipart
import jakarta.mail.Part
import jakarta.mail.Session
import jakarta.mail.internet.InternetAddress
import jakarta.mail.internet.MimeMessage
import java.io.ByteArrayInputStream
import java.util.Properties

data class RawEmail(
  val messageId: String?, val fromName: String?, val fromAddress: String,
  val subject: String, val text: String,   // plain text of the body (HTML part preferred, converted by HtmlText)
  val at: Long,                             // IMAP INTERNALDATE (arrival at Gmail), epoch ms
)

object Email {
  const val GMAIL = "com.google.android.gm"

  private val session: Session by lazy { Session.getInstance(Properties()) }

  private class Found { var html: String? = null; var plain: String? = null }

  /** Null when the bytes are not a readable message or have no text body. */
  fun read(raw: ByteArray, at: Long): RawEmail? = try {
    val msg = MimeMessage(session, ByteArrayInputStream(raw))
    val from = msg.getFrom()?.firstOrNull() as? InternetAddress
    val address = from?.address?.trim()
    val found = Found().also { collect(msg, it) }
    val text = (found.html?.let(HtmlText::toPlain) ?: found.plain)?.trim()
    if (address.isNullOrEmpty() || text.isNullOrEmpty()) null
    else RawEmail(msg.messageID?.trim(), from.personal?.trim()?.ifEmpty { null }, address, msg.subject.orEmpty(), text, at)
  } catch (e: Exception) {
    null
  }

  // Attachments are skipped; an unknown charset throws and only drops that part.
  private fun collect(p: Part, out: Found) {
    if (Part.ATTACHMENT.equals(p.disposition, ignoreCase = true)) return
    when {
      p.isMimeType("multipart/*") -> {
        val mp = p.content as Multipart
        for (i in 0 until mp.count) collect(mp.getBodyPart(i), out)
      }
      p.isMimeType("text/html") -> if (out.html == null) out.html = runCatching { p.content as? String }.getOrNull()
      p.isMimeType("text/plain") -> if (out.plain == null) out.plain = runCatching { p.content as? String }.getOrNull()
    }
  }

  fun hash(e: RawEmail): String = Sms.sha256Hex("email\u0000${e.messageId ?: "${e.fromAddress}\u0000${e.at}\u0000${e.subject}"}")

  fun capture(e: RawEmail, label: String): Capture {
    val sender = e.fromName ?: e.fromAddress
    return Capture(
      pkg = GMAIL, appLabel = label, sender = sender, senderKey = senderKey(GMAIL, sender),
      conversation = null, conversationKey = null, title = e.subject, text = e.text,
      postedAt = e.at, hash = hash(e), deletedPlaceholder = false,
    )
  }
}
