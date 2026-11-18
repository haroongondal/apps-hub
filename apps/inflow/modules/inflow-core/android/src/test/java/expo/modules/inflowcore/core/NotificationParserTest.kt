package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationParserTest {
  private val own = "com.haroon.inflow"

  private fun raw(
    pkg: String = "com.example.app",
    key: String = "0|com.example.app|1|null|10001",
    postTime: Long = 1_000L,
    ongoing: Boolean = false,
    groupSummary: Boolean = false,
    title: String? = null,
    text: String? = null,
    bigText: String? = null,
    conversationTitle: String? = null,
    isGroupConversation: Boolean = false,
    messages: List<RawMessage> = emptyList(),
    textLines: List<String> = emptyList(),
    chatTag: String? = null,
    shortcutId: String? = null,
  ) = RawNotification(
    pkg = pkg, appLabel = "App", key = key, postTime = postTime,
    ongoing = ongoing, groupSummary = groupSummary,
    title = title, text = text, bigText = bigText, subText = null,
    conversationTitle = conversationTitle, isGroupConversation = isGroupConversation,
    messages = messages, textLines = textLines, chatTag = chatTag, shortcutId = shortcutId,
  )

  private class Chats : ChatDirectory {
    val map = HashMap<String, String>()
    override fun nameFor(tag: String) = map[tag]
    override fun learn(tag: String, name: String) { map[tag] = name }
  }

  private val wa = "com.whatsapp"
  private val sunflower = listOf(RawMessage("Sunflower", "Are you free?", 10L), RawMessage("Sunflower", "Call me", 20L))
  private val reply = RawMessage("You", "On my way", 30L, own = true)

  @Test fun replyRetitlesNotificationButStaysOneThread() {
    val chats = Chats()
    val a = NotificationParser.parse(raw(pkg = wa, title = "Sunflower", messages = sunflower, chatTag = "t1"), own, chats)
    val b = NotificationParser.parse(raw(pkg = wa, title = "You", messages = sunflower + reply, chatTag = "t1"), own, chats)
    assertTrue((a + b).all { it.conversation == "Sunflower" && it.conversationKey == "com.whatsapp:sunflower" })
    assertEquals(a.map { it.hash }, b.take(2).map { it.hash })   // the contact's messages are not saved a second time
    assertEquals("You", b[2].sender)
  }

  @Test fun replyOnlyNotificationUsesLearnedName() {
    val chats = Chats()
    NotificationParser.parse(raw(pkg = wa, title = "Sunflower", messages = sunflower, shortcutId = "123@lid"), own, chats)
    val only = NotificationParser.parse(raw(pkg = wa, title = "You", messages = listOf(reply), shortcutId = "123@lid"), own, chats).single()
    assertEquals("Sunflower", only.conversation)
    assertEquals("com.whatsapp:sunflower", only.conversationKey)
    // Without a learned name the title is all there is.
    assertEquals("You", NotificationParser.parse(raw(pkg = wa, title = "You", messages = listOf(reply), shortcutId = "other@lid"), own, chats).single().conversation)
  }

  @Test fun groupStaysGroup() {
    val out = NotificationParser.parse(
      raw(pkg = wa, title = "Family", conversationTitle = "Family", isGroupConversation = true, chatTag = "g1",
        messages = listOf(RawMessage("Ammi", "Dinner", 1L), reply)),
      own, Chats(),
    )
    assertTrue(out.all { it.conversation == "Family" && it.conversationKey == "com.whatsapp:family" })
    assertEquals(listOf("Ammi", "You"), out.map { it.sender })
  }

  @Test fun ownMessageSenderIsYou() {
    val out = NotificationParser.parse(
      raw(pkg = wa, title = "Ammi", messages = listOf(RawMessage("Ammi", "Hi", 1L), RawMessage("Haroon", "Hello", 2L, own = true), RawMessage("you", "Again", 3L), RawMessage(null, "Third", 4L))),
      own,
    )
    assertEquals(listOf("Ammi", "You", "You", "You"), out.map { it.sender })
    assertEquals(setOf("Ammi"), out.map { it.conversation }.toSet())
  }

  @Test fun twoContactsStayTwoThreads() {
    val chats = Chats()
    val a = NotificationParser.parse(raw(pkg = wa, title = "Sunflower", messages = sunflower, chatTag = "t1"), own, chats)
    val b = NotificationParser.parse(raw(pkg = wa, title = "Moon", messages = listOf(RawMessage("Moon", "Hi", 10L)), chatTag = "t2"), own, chats)
    assertEquals(setOf("com.whatsapp:sunflower"), a.map { it.conversationKey }.toSet())
    assertEquals(setOf("com.whatsapp:moon"), b.map { it.conversationKey }.toSet())
    assertEquals("Moon", chats.nameFor("com.whatsapp|t2"))
    assertEquals("Sunflower", chats.nameFor("com.whatsapp|t1"))
  }

  @Test fun skipsOwnOngoingAndSummary() {
    val base = raw(title = "Hi", text = "There")
    assertTrue(NotificationParser.parse(base.copy(pkg = own), own).isEmpty())
    assertTrue(NotificationParser.parse(base.copy(ongoing = true), own).isEmpty())
    assertTrue(NotificationParser.parse(base.copy(groupSummary = true), own).isEmpty())
    assertEquals(1, NotificationParser.parse(base, own).size)
  }

  @Test fun blankNotificationGivesNothing() {
    assertTrue(NotificationParser.parse(raw(title = " ", text = "", bigText = null, textLines = listOf(" ")), own).isEmpty())
  }

  @Test fun messagesWithBlankTitleAndTextAreKept() {
    val n = raw(
      title = " ", text = "", bigText = null, textLines = emptyList(),
      messages = listOf(RawMessage("Ali", "Hello", 7L)),
    )
    val out = NotificationParser.parse(n, own)
    assertEquals(1, out.size)
    assertEquals("Hello", out[0].text)
    assertEquals("Ali", out[0].sender)
  }

  @Test fun smsShortCodeKeepsTextExactly() {
    val sample = "Dear Customer,\n" +
      "Your Debit Card against A/C: 0847-1***2310 is charged for PKR 1,500.00 on 12-Nov-26 at 16:23:38 at SHAAFI INTERNATIONAL HOSPIslamabad PK."
    val n = raw(
      pkg = "com.google.android.apps.messaging", title = "8287",
      messages = listOf(RawMessage("8287", sample, 5_000L)),
    )
    val out = NotificationParser.parse(n, own)
    assertEquals(1, out.size)
    val c = out[0]
    assertEquals(sample, c.text)
    assertEquals("num:8287", c.senderKey)
    assertEquals("num:8287", c.conversationKey)
    assertEquals("8287", c.sender)
    assertEquals("8287", c.conversation)
    assertEquals(5_000L, c.postedAt)
  }

  @Test fun whatsappGroupMessages() {
    val n = raw(
      pkg = "com.whatsapp", title = "Family group", conversationTitle = "Family group",
      isGroupConversation = true,
      messages = listOf(RawMessage("Ammi", "Dinner at 8", 1L), RawMessage("Ali", "Okay", 2L)),
    )
    val out = NotificationParser.parse(n, own)
    assertEquals(2, out.size)
    assertEquals(listOf("Ammi", "Ali"), out.map { it.sender })
    assertTrue(out.all { it.conversation == "Family group" })
    assertTrue(out.all { it.conversationKey == "com.whatsapp:family group" })
    assertEquals(listOf("com.whatsapp:ammi", "com.whatsapp:ali"), out.map { it.senderKey })
    assertEquals(listOf(1L, 2L), out.map { it.postedAt })
  }

  @Test fun ownerMessageIsFromYou() {
    val n = raw(pkg = "com.whatsapp", title = "Ammi", messages = listOf(RawMessage(null, "Coming", 3L)))
    val c = NotificationParser.parse(n, own).single()
    assertEquals("You", c.sender)
    assertEquals("Ammi", c.conversation)
  }

  @Test fun blankMessageIsSkipped() {
    val n = raw(title = "Ammi", messages = listOf(RawMessage("Ammi", "  ", 1L), RawMessage("Ammi", "Hello", 2L)))
    val out = NotificationParser.parse(n, own)
    assertEquals(listOf("Hello"), out.map { it.text })
  }

  @Test fun gmailUsesBigText() {
    val big = "Transaction alert\nPKR 1,500.00 charged\u2026"
    val n = raw(pkg = "com.google.android.gm", title = "Bank Alfalah", text = "Transaction alert", bigText = big)
    val c = NotificationParser.parse(n, own).single()
    assertEquals("Bank Alfalah", c.sender)
    assertEquals(big, c.text)
    assertNull(c.conversation)
    assertNull(c.conversationKey)
    assertEquals("Bank Alfalah", c.title)
  }

  @Test fun textLinesAreTheLastFallback() {
    val n = raw(title = "Inbox", text = null, bigText = null, textLines = listOf("one", "two"))
    assertEquals("one\ntwo", NotificationParser.parse(n, own).single().text)
  }

  @Test fun nullTitleKeepsNullSender() {
    val c = NotificationParser.parse(raw(title = null, text = "Body"), own).single()
    assertNull(c.sender)
    assertNull(c.senderKey)
  }

  @Test fun sameContentSameHashAcrossReposts() {
    val a = raw(title = "Bank", text = "Hello", postTime = 1_000L)
    val b = a.copy(postTime = 9_000L)
    val ca = NotificationParser.parse(a, own).single()
    val cb = NotificationParser.parse(b, own).single()
    assertEquals(ca.hash, cb.hash)
    assertEquals(64, ca.hash.length)
    assertNotEquals(ca.hash, NotificationParser.parse(a.copy(text = "Other"), own).single().hash)
  }

  @Test fun messageHashIncludesTime() {
    fun one(time: Long) = NotificationParser.parse(
      raw(title = "Ammi", messages = listOf(RawMessage("Ammi", "Hi", time))), own,
    ).single().hash
    assertNotEquals(one(1L), one(2L))
    assertEquals(one(1L), one(1L))
  }

  @Test fun urduAndEmojiUntouched() {
    val text = "کل میٹنگ ہے 👍"
    val c = NotificationParser.parse(raw(title = "Ali", messages = listOf(RawMessage("Ali", text, 1L))), own).single()
    assertEquals(text, c.text)
    assertEquals(text.toByteArray(Charsets.UTF_8).toList(), c.text.toByteArray(Charsets.UTF_8).toList())
  }

  @Test fun textIsNeverTrimmed() {
    val text = "  padded text \n"
    val c = NotificationParser.parse(raw(title = "Ali", messages = listOf(RawMessage("Ali", text, 1L))), own).single()
    assertEquals(text, c.text)
  }

  @Test fun deletedPlaceholderFlagged() {
    fun flag(t: String) = NotificationParser.parse(
      raw(pkg = "com.whatsapp", title = "Ali", messages = listOf(RawMessage("Ali", t, 1L))), own,
    ).single().deletedPlaceholder
    assertTrue(flag("This message was deleted"))
    assertTrue(flag("  this MESSAGE was deleted \n"))
    assertTrue(flag("You deleted this message"))
    assertTrue(flag("یہ پیغام حذف کر دیا گیا تھا"))
    assertFalse(flag("Hello"))
  }

  @Test fun phoneNumbersNormalise() {
    assertEquals("num:3001234567", senderKey("x", "+92 300 1234567"))
    assertEquals("num:3001234567", senderKey("y", "0300-1234567"))
    assertEquals("num:8287", senderKey("z", "8287"))
  }

  @Test fun namesNormalise() {
    assertEquals("com.whatsapp:family group", senderKey("com.whatsapp", "  Family   GROUP "))
    assertEquals("p:bank alfalah", senderKey("p", "Bank Alfalah"))
  }

  @Test fun aBlankMessageWithMediaIsKeptWithAnEmptyTextAndItsOwnHash() {
    val file: MediaSupplier = { RawMedia("image/jpeg", byteArrayOf(1)) }
    val out = NotificationParser.parse(
      raw(
        pkg = "com.whatsapp", title = "Sunflower",
        messages = listOf(RawMessage("Sunflower", "", 1_000L, media = file), RawMessage("Sunflower", "", 2_000L, media = file), RawMessage("Sunflower", " ", 3_000L)),
      ),
      own,
    )
    assertEquals(listOf(1_000L, 2_000L), out.map { it.postedAt })
    assertEquals(listOf("", ""), out.map { it.text })
    assertEquals(2, out.map { it.hash }.toSet().size)
    assertTrue(out.all { it.media === file && !it.deletedPlaceholder })
    assertFalse(OtpDetector.isOtp("com.whatsapp", ""))
    assertNull(BankParser.parse(""))
  }

  private fun assertNotEquals(a: Any?, b: Any?) = org.junit.Assert.assertNotEquals(a, b)

  @Test fun aGenericNotificationTitleIsNeverTheChatName() {
    val msgs = listOf(RawMessage(null, "Hi", 1L))
    val c = NotificationParser.parse(raw(pkg = "com.linkedin.android", title = "1 new message", messages = msgs), own).single()
    assertNull(c.conversation)
    assertNull(c.conversationKey)
    assertEquals("You", c.sender)
  }

  @Test fun aGroupTitleOrLearnedNameBeatsAGenericTitle() {
    val msgs = listOf(RawMessage(null, "Hi", 1L))
    val group = NotificationParser.parse(raw(pkg = wa, title = "1 new message", conversationTitle = "Family", messages = msgs), own).single()
    assertEquals("Family", group.conversation)
    val chats = Chats().also { it.learn("$wa|t9", "Sunflower") }
    val learned = NotificationParser.parse(raw(pkg = wa, title = "1 new message", messages = msgs, chatTag = "t9"), own, chats).single()
    assertEquals("Sunflower", learned.conversation)
  }
}
