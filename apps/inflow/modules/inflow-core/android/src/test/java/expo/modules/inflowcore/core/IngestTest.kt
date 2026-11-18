package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IngestTest {
  private val own = "com.haroon.inflow"
  private val day = Ingest.DAY_MS
  private var clock = 1_700_000_000_000L
  private val store = MemoryItemStore()
  private val otpExpiries = mutableListOf<Long>()
  private val ingest = Ingest(store, own, { clock }, { otpExpiries += it })

  private fun raw(
    pkg: String = "com.example.app",
    key: String = "0|com.example.app|1|null|10001",
    title: String? = null,
    text: String? = null,
    messages: List<RawMessage> = emptyList(),
  ) = RawNotification(
    pkg = pkg, appLabel = "App", key = key, postTime = clock,
    ongoing = false, groupSummary = false,
    title = title, text = text, bigText = null, subText = null,
    conversationTitle = null, isGroupConversation = false,
    messages = messages, textLines = emptyList(),
  )

  private fun capture(pkg: String, hash: String, postedAt: Long) = Capture(
    pkg = pkg, appLabel = "App", sender = "Ali", senderKey = "$pkg:ali",
    conversation = null, conversationKey = null, title = "Ali", text = hash,
    postedAt = postedAt, hash = hash, deletedPlaceholder = false,
  )

  private fun chat(vararg messages: RawMessage) = raw(pkg = "com.whatsapp", title = "Ammi", messages = messages.toList())

  @Test fun repostedHistorySavesEachMessageOnce() {
    val m1 = RawMessage("Ammi", "one", clock + 1)
    val m2 = RawMessage("Ammi", "two", clock + 2)
    val m3 = RawMessage("Ammi", "three", clock + 3)
    val m4 = RawMessage("Ammi", "four", clock + 4)
    assertEquals(3, ingest.onNotification(chat(m1, m2, m3)))
    assertEquals(1, ingest.onNotification(chat(m1, m2, m3, m4)))
    assertEquals(4, store.items.size)
  }

  @Test fun replyRetitlesNotificationButStaysOneThread() {
    val m1 = RawMessage("Sunflower", "Are you free?", clock + 1)
    val m2 = RawMessage("Sunflower", "Call me", clock + 2)
    val reply = RawMessage("You", "On my way", clock + 3, own = true)
    assertEquals(2, ingest.onNotification(chat(m1, m2).copy(title = "Sunflower", chatTag = "t1")))
    assertEquals(1, ingest.onNotification(chat(m1, m2, reply).copy(title = "You", chatTag = "t1")))
    assertEquals(3, store.items.size)
    assertEquals(setOf("Sunflower"), store.items.values.map { it.capture.conversation }.toSet())
  }

  @Test fun anOwnMessageClosesTheConversationsReplySuggestions() {
    val closed = mutableListOf<String>()
    val ing = Ingest(store, own, { clock }, onOwnMessage = { pkg, key -> closed += "$pkg|$key" })
    val m1 = RawMessage("Sunflower", "Are you free?", clock + 1)
    val reply = RawMessage("You", "On my way", clock + 3, own = true)
    ing.onNotification(chat(m1).copy(title = "Sunflower", chatTag = "t1"))
    assertTrue(closed.isEmpty())
    ing.onNotification(chat(m1, reply).copy(title = "You", chatTag = "t1"))
    assertEquals(listOf("com.whatsapp|" + store.items.values.first().capture.conversationKey!!), closed)
  }

  @Test fun aFailingOwnMessageCallbackNeverLosesTheItem() {
    val ing = Ingest(store, own, { clock }, onOwnMessage = { _, _ -> error("boom") })
    assertEquals(1, ing.onNotification(chat(RawMessage("You", "On my way", clock + 3, own = true)).copy(title = "Sunflower", chatTag = "t1")))
    assertEquals(1, store.items.size)
  }

  // R44 and its one exception: a picked chat's messages are queued (fast); an unpicked chat's never are.
  private fun aiIngest(picked: Set<String>, fast: MutableList<Unit> = mutableListOf()) =
    Ingest(store, own, { clock }, aiOn = { true }, pickedChat = { pkg, key -> key != null && "$pkg|$key" in picked }, onFast = { fast += Unit })

  private val ammiKey = "com.whatsapp|" + senderKey("com.whatsapp", "Ammi")

  @Test fun aPickedWhatsAppChatIsQueuedFast() {
    val fast = mutableListOf<Unit>()
    assertEquals(1, aiIngest(setOf(ammiKey), fast).onNotification(chat(RawMessage("Ammi", "dinner at 8?", clock + 1))))
    assertEquals(setOf(store.items.values.single().id), store.queue.keys)
    assertEquals(store.queue.keys, store.fastIds)
    assertEquals(1, fast.size)
  }

  @Test fun anUnpickedWhatsAppChatIsNotQueued() {
    val fast = mutableListOf<Unit>()
    assertEquals(1, aiIngest(setOf("com.whatsapp|whatsapp:someone-else"), fast).onNotification(chat(RawMessage("Ammi", "dinner at 8?", clock + 1))))
    assertTrue(store.queue.isEmpty())
    assertTrue(fast.isEmpty())
  }

  @Test fun anOtpIsNeverQueuedEvenWhenItsChatIsPicked() {
    val smsPkg = "com.google.android.apps.messaging"
    val ing = aiIngest(setOf("$smsPkg|" + senderKey(smsPkg, "MCB")))
    ing.onNotification(raw(pkg = smsPkg, title = "MCB", messages = listOf(RawMessage("MCB", "Your OTP is 482913. Do not share it.", clock + 1))))
    val otp = store.items.values.single()
    assertEquals(senderKey(smsPkg, "MCB"), otp.capture.conversationKey)   // a real, picked conversation: only the OTP rule keeps it out
    assertNotNull(otp.otpExpiresAt)
    assertTrue(store.queue.isEmpty())
  }

  @Test fun aPickedNumberChatInAnotherAppIsNotQueued() {
    // Both apps give an all-digit chat name the same conversation key (num:...), so the pick must carry the package.
    val fast = mutableListOf<Unit>()
    val ing = aiIngest(setOf("com.whatsapp|" + senderKey("com.whatsapp", "+92 300 1234567")), fast)
    ing.onNotification(raw(pkg = "org.thoughtcrime.securesms", title = "+92 300 1234567", messages = listOf(RawMessage("+92 300 1234567", "hi from signal", clock + 1))))
    assertEquals(senderKey("com.whatsapp", "+92 300 1234567"), store.items.values.single().capture.conversationKey)
    assertTrue(store.queue.isEmpty())
    assertTrue(fast.isEmpty())
    ing.onNotification(chat(RawMessage("+92 300 1234567", "hi from whatsapp", clock + 2)).copy(title = "+92 300 1234567"))
    assertEquals(1, store.queue.size)
  }

  @Test fun anOwnMessageInAPickedChatIsContextNotAFastTrigger() {
    val fast = mutableListOf<Unit>()
    aiIngest(setOf(ammiKey), fast).onNotification(chat(RawMessage("Ammi", "hi", clock + 1), RawMessage("You", "on my way", clock + 2, own = true)))
    assertEquals(2, store.queue.size)
    assertEquals(1, store.fastIds.size)
    assertEquals(1, fast.size)
  }

  @Test fun aPersonSmsIsFastAndAShortCodeIsNot() {
    val fast = mutableListOf<Unit>()
    val ing = aiIngest(emptySet(), fast)
    ing.onSms(RawSms("+923001234567", "call me", clock, clock), "com.google.android.apps.messaging", "Messages")
    ing.onSms(RawSms("8287", "Your balance is low", clock + 1, clock + 1), "com.google.android.apps.messaging", "Messages")
    assertEquals(2, store.queue.size)   // both SMS are queued as before
    assertEquals(1, store.fastIds.size)
    assertEquals(1, fast.size)
    assertEquals("call me", store.items.values.first { it.id in store.fastIds }.capture.text)
  }

  // The retention pins: WhatsApp text is kept forever and never mistaken for a code.
  @Test fun whatsappIsKeptForever() {
    assertNull(Retention.default("com.whatsapp", "WhatsApp").keepDays)
    assertNull(Retention.default("com.whatsapp.w4b", "WhatsApp Business").keepDays)
  }

  @Test fun whatsappCodeLikeTextIsNeverAnOtp() {
    assertEquals(1, ingest.onNotification(chat(RawMessage("Ammi", "Your code is 482913, pin 1234, do not share", clock + 1))))
    assertNull(store.items.values.single().otpExpiresAt)
    assertTrue(otpExpiries.isEmpty())
  }

  @Test fun purgeNeverTouchesWhatsappWithoutAnExplicitChoice() {
    ingest.onNotification(chat(RawMessage("Ammi", "old news", clock - 400 * day)))
    ingest.onNotification(raw(pkg = "com.daraz.android", title = "Daraz", text = "old sale").let { it.copy(postTime = clock - 400 * day) })
    clock += 2 * day
    ingest.housekeeping()
    assertEquals(1, store.items.values.count { it.capture.pkg == "com.whatsapp" })
    assertEquals(0, store.items.values.count { it.capture.pkg == "com.daraz.android" })   // the 90-day default does purge other apps
    store.putAppSetting(AppSetting("com.whatsapp", "WhatsApp", true, 90))   // only the owner's explicit choice deletes
    clock += 2 * day
    ingest.housekeeping()
    assertEquals(0, store.items.values.count { it.capture.pkg == "com.whatsapp" })
  }

  @Test fun sameKeySameTextIsOneItem() {
    val n = raw(title = "Bank", text = "Hello")
    assertEquals(1, ingest.onNotification(n))
    assertEquals(0, ingest.onNotification(n))
    assertEquals(1, store.items.size)
  }

  @Test fun recordOffSavesNothing() {
    store.putAppSetting(AppSetting("com.example.app", "App", false, 90))
    assertEquals(0, ingest.onNotification(raw(title = "Bank", text = "Hello")))
    assertTrue(store.items.isEmpty())
  }

  @Test fun strongroomOffByDefault() {
    assertEquals(0, ingest.onNotification(raw(pkg = Retention.STRONGROOM, title = "Vault", text = "Unlocked")))
    assertEquals(false, store.appSetting(Retention.STRONGROOM)?.record)
    assertTrue(store.items.isEmpty())
  }

  @Test fun ownNotificationsAreNeverRecorded() {
    assertEquals(0, ingest.onNotification(raw(pkg = own, title = "Inflow", text = "Saved")))
    assertNull(store.appSetting(own))
    assertTrue(store.items.isEmpty())
  }

  @Test fun defaultsKeepForever() {
    ingest.onNotification(raw(pkg = "com.whatsapp", title = "Ammi", text = "Hi"))
    ingest.onNotification(raw(pkg = "com.daraz.android", title = "Daraz", text = "Sale"))
    assertNull(store.appSetting("com.whatsapp")?.keepDays)
    assertNotNull(store.appSetting("com.whatsapp"))
    assertEquals(90, store.appSetting("com.daraz.android")?.keepDays)
    assertEquals(true, store.appSetting("com.daraz.android")?.record)
  }

  @Test fun otpPurgedAndTombstoned() {
    val otp = raw(title = "Bank", text = "Your OTP is 482913. Do not share it.")
    assertEquals(1, ingest.onNotification(otp))
    assertEquals(clock + Ingest.OTP_TTL_MS, store.items.values.single().otpExpiresAt)
    clock += Ingest.OTP_TTL_MS + 1
    ingest.housekeeping()
    assertTrue(store.items.isEmpty())
    assertEquals(0, ingest.onNotification(otp))
    assertTrue(store.items.isEmpty())
  }

  @Test fun savedOtpReportsItsExpiryOnce() {
    val otp = raw(title = "Bank", text = "Your OTP is 482913. Do not share it.")
    ingest.onNotification(raw(title = "Bank", text = "Hello"))
    ingest.onNotification(otp)
    ingest.onNotification(otp)
    assertEquals(listOf(clock + Ingest.OTP_TTL_MS), otpExpiries)
  }

  @Test fun deletedBySenderKeepsOriginal() {
    val sent = RawMessage("Ammi", "Meet at 5", clock + 10)
    assertEquals(1, ingest.onNotification(chat(sent)))
    val gone = RawMessage("Ammi", "This message was deleted", clock + 10)
    assertEquals(0, ingest.onNotification(chat(gone)))
    val item = store.items.values.single()
    assertEquals("Meet at 5", item.capture.text)
    assertTrue(item.deleted)
    assertFalse(store.items.values.any { it.capture.text == "This message was deleted" })
  }

  @Test fun retentionRunsOncePerDay() {
    val pkg = "com.example.app"
    store.putAppSetting(AppSetting(pkg, "App", true, 90))
    val first = clock
    store.insert(capture(pkg, "old-1", clock - 91 * day), "old-1", null)
    ingest.housekeeping()
    assertTrue(store.items.isEmpty())

    clock += 60 * 60_000L
    store.insert(capture(pkg, "old-2", clock - 91 * day), "old-2", null)
    ingest.housekeeping()
    assertEquals(1, store.items.size)

    clock = first + day
    ingest.housekeeping()
    assertTrue(store.items.isEmpty())
  }
}
