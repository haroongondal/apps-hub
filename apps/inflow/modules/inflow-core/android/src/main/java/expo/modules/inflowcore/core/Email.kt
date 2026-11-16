package expo.modules.inflowcore.core

import jakarta.mail.FolderClosedException
import jakarta.mail.Message
import jakarta.mail.MessagingException
import jakarta.mail.Multipart
import jakarta.mail.Part
import jakarta.mail.Session
import jakarta.mail.StoreClosedException
import jakarta.mail.internet.InternetAddress
import jakarta.mail.internet.MimeMessage
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.Properties

data class RawEmail(
  val messageId: String?, val fromName: String?, val fromAddress: String,
  val subject: String, val text: String,   // plain text of the body (HTML part preferred, converted by HtmlText)
  val at: Long,                             // IMAP INTERNALDATE (arrival at Gmail), epoch ms
)

object Email {
  const val GMAIL = "com.google.android.gm"

  private const val NBSP = '\u00A0'
  private val session: Session by lazy { Session.getInstance(Properties()) }

  private class Found { var html: String? = null; var plain: String? = null }

  /** Null when the bytes are not a readable message or have no text body. */
  fun read(raw: ByteArray, at: Long): RawEmail? = try {
    val msg = MimeMessage(session, ByteArrayInputStream(raw))
    val from = msg.getFrom()?.firstOrNull() as? InternetAddress
    val address = from?.address?.trim()
    val found = Found().also { collect(msg, it) }
    val text = (found.html?.let(HtmlText::toPlain) ?: found.plain?.replace(NBSP, ' '))?.trim()
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

  /**
   * The IMAP FROM search is a substring match, so a lookalike domain would pass it. An address query (has '@') must equal the
   * sender's address; "@domain" matches that exact domain only; a name query (R13) matches a substring of the name or the
   * address. R20: no DKIM/DMARC gate.
   */
  fun fromMatches(e: RawEmail, query: String): Boolean {
    val q = query.trim()
    if (q.startsWith("@")) return e.fromAddress.endsWith(q, ignoreCase = true)
    if ('@' in q) return e.fromAddress.equals(q, ignoreCase = true)
    return e.fromName.orEmpty().contains(q, ignoreCase = true) || e.fromAddress.contains(q, ignoreCase = true)
  }

  /**
   * Null for a message that is too big, expunged meanwhile or cannot be downloaded, so the cursor moves past it (G3).
   * A closed folder or store is a lost connection and still propagates.
   */
  fun fromMessage(msg: Message, maxBytes: Int): RawEmail? = try {
    if (msg.size > maxBytes) null
    else {
      val at = msg.receivedDate?.time ?: msg.sentDate?.time ?: System.currentTimeMillis()
      read(ByteArrayOutputStream().also { msg.writeTo(it) }.toByteArray(), at)
    }
  } catch (e: FolderClosedException) {
    throw e
  } catch (e: StoreClosedException) {
    throw e
  } catch (e: MessagingException) {
    null
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
