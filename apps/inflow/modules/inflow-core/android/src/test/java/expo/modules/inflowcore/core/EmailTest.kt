package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random

class EmailTest {
  private val at = 1_700_000_000_000L

  private fun eml(name: String) = javaClass.getResourceAsStream("/email/$name")!!.readBytes()

  @Test fun readsHtmlEmail() {
    val e = Email.read(eml("ubl.eml"), at)!!
    assertEquals("UBL Digital", e.fromName)
    assertEquals("admin.ebanking@ubl.com.pk", e.fromAddress)
    assertEquals("Raast payment alert", e.subject)
    assertEquals("<ubl-1430551744@mail.ubl.example>", e.messageId)
    assertEquals(at, e.at)
    assertEquals(
      Parsed(Direction.OUT, 700000, "PKR", "UBL 33", "JAYISHA NOOR", "1430551744", accountPartial = true),
      BankParser.parse(e.text),
    )
  }

  @Test fun readsMultipartPrefersHtml() {
    val e = Email.read(eml("alfalah.eml"), at)!!
    assertEquals("email.notification@bankalfalah.com", e.fromAddress)
    assertEquals("Bank Alfalah – Transaction Successful", e.subject)
    assertFalse(e.text.contains("View this email in HTML"))
    assertEquals(
      Parsed(Direction.OUT, 170000, "PKR", "Alfalah 2310", null, "FT263160G6MC4S12"),
      BankParser.parse(e.text),
    )
  }

  @Test fun unreadableIsNull() {
    assertNull(Email.read(ByteArray(300).also { Random(7).nextBytes(it) }, at))
    val attachmentOnly = """From: a@b.example
Subject: scan
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="x"

--x
Content-Type: application/pdf
Content-Disposition: attachment; filename="a.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQK
--x--
"""
    assertNull(Email.read(attachmentOnly.toByteArray(), at))
  }

  private fun email(messageId: String?, from: String = "a@b.example", subject: String = "s", t: Long = at) =
    RawEmail(messageId, null, from, subject, "body", t)

  @Test fun hashUsesMessageIdElseFields() {
    assertEquals(Email.hash(email("<m1>", from = "x@y.example", t = 1)), Email.hash(email("<m1>", subject = "other", t = 2)))
    assertNotEquals(Email.hash(email("<m1>")), Email.hash(email("<m2>")))
    assertEquals(Email.hash(email(null)), Email.hash(email(null)))
    assertNotEquals(Email.hash(email(null)), Email.hash(email(null, t = at + 1)))
    assertNotEquals(Email.hash(email(null)), Email.hash(email(null, subject = "t")))
    assertNotEquals(Email.hash(email(null)), Email.hash(email(null, from = "c@d.example")))
  }

  @Test fun captureFollowsTheContract() {
    val c = Email.capture(RawEmail("<m>", "UBL Digital", "u@ubl.example", "Subj", "Body", at), "Gmail")
    assertEquals(Email.GMAIL, c.pkg)
    assertEquals("UBL Digital", c.sender)
    assertEquals(senderKey(Email.GMAIL, "UBL Digital"), c.senderKey)
    assertNull(c.conversationKey)
    assertEquals("Subj", c.title)
    assertEquals("Body", c.text)
    assertEquals(at, c.postedAt)
    assertFalse(c.deletedPlaceholder)
    assertEquals("u@ubl.example", Email.capture(RawEmail("<m>", null, "u@ubl.example", "S", "B", at), "Gmail").sender)
  }

  private fun parsed(account: String, partial: Boolean) =
    Parsed(Direction.OUT, 700000, "PKR", account, "X", null, accountPartial = partial)

  @Test fun partialAccountResolves() {
    val r = Accounts.resolve(parsed("UBL 33", true), listOf("UBL 1733", "Alfalah 2310"))
    assertEquals("UBL 1733", r.account)
    assertFalse(r.accountPartial)
  }

  @Test fun partialAccountAmbiguousStays() {
    val p = parsed("UBL 33", true)
    assertEquals(p, Accounts.resolve(p, listOf("UBL 1733", "UBL 9933")))
    assertEquals(p, Accounts.resolve(p, listOf("UBL 33", "Alfalah 2333")))
    assertEquals(p, Accounts.resolve(p, emptyList()))
  }

  @Test fun fullAccountUntouched() {
    val p = parsed("UBL 1733", false)
    assertEquals(p, Accounts.resolve(p, listOf("UBL 9933")))
    assertTrue(Accounts.resolve(p, listOf("UBL 1733")).account == "UBL 1733")
    assertNotNull(p)
  }
}
