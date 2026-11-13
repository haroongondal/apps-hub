package expo.modules.noteboxcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IngestTest {
  private val own = "com.haroon.notebox"
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
    assertEquals(0, ingest.onNotification(raw(pkg = own, title = "Notebox", text = "Saved")))
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
