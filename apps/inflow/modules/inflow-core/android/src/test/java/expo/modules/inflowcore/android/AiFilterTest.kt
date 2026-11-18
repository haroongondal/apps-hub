package expo.modules.inflowcore.android

import expo.modules.inflowcore.core.AUTOPILOT_META
import expo.modules.inflowcore.core.AiChannels
import expo.modules.inflowcore.core.AiMeta
import expo.modules.inflowcore.core.AppSetting
import expo.modules.inflowcore.core.AutopilotSettings
import expo.modules.inflowcore.core.Capture
import expo.modules.inflowcore.core.MemoryItemStore
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// No store-level SQL harness (R32): the filter text is run in sqlite3 by hand; this pins that it carries R44 and the shared package list.
class AiFilterTest {
  @Test fun neverSendFilterKeepsOnlySmsAndEmail() {
    val f = SqlItemStore.NEVER_SEND_FILTER
    assertTrue(f.contains("i.sms_hash IS NOT NULL OR i.email_hash IS NOT NULL OR i.pkg IN (${AiChannels.SQL_LIST})"))
    AiChannels.PKGS.forEach { assertTrue(it, f.contains("'$it'")) }
    assertEquals(4, AiChannels.PKGS.size)
  }

  // R44 and its one exception (owner, 2026-11-18): the queue may also take a conversation the owner picked; Ask AI never does.
  @Test fun queueFilterAddsOnlyThePickedConversationsAndBindsThem() {
    val none = SqlItemStore.queueFilter(0)
    assertTrue(none.contains("(i.sms_hash IS NOT NULL OR i.email_hash IS NOT NULL OR i.pkg IN (${AiChannels.SQL_LIST}) OR 0)"))
    val two = SqlItemStore.queueFilter(2)
    assertTrue(two.contains("OR i.conversation_key IN (?,?))"))
    assertEquals(2, two.count { it == '?' })
    // Everything else NEVER_SEND_FILTER demands stays: no OTP, record on, app and sender not blocked.
    assertTrue(two.startsWith("i.otp_expires_at IS NULL AND "))
    assertTrue(two.endsWith(SqlItemStore.SENDABLE))
  }

  @Test fun neverSendFilterKnowsNothingOfPickedChats() {
    assertFalse(SqlItemStore.NEVER_SEND_FILTER.contains("conversation_key"))
    assertFalse(SqlItemStore.NEVER_SEND_FILTER.contains("?"))
  }

  // askItems, askTxns and the ledger's never-sent bookkeeping run SQL that cannot run here, so this reads the sources: only queued() and queuedCount() may use queueFilter.
  @Test fun onlyTheQueueUsesTheWidenedFilter() {
    val dir = File("src/main/java/expo/modules/inflowcore")
    val users = dir.walkTopDown().filter { it.extension == "kt" }
      .filter { f -> f.readLines().any { l -> "queueFilter" in l && !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//") } }.map { it.name }.toSet()
    assertEquals(setOf("SqlItemStore.kt"), users)
    val store = File(dir, "android/SqlItemStore.kt").readText()
    val ask = store.substringAfter("fun askItems(").substringBefore("\n  }\n")
    assertTrue(ask.contains("NEVER_SEND_FILTER"))
    assertFalse(ask.contains("queueFilter"))
    assertTrue(File(dir, "android/SqlLedgerStore.kt").readText().contains("NEVER_SEND_FILTER"))
  }

  // The fake mirrors queued(); the real SQL was run in sqlite3 (see the T6 report).
  private val now = 1_700_000_000_000L
  private fun cap(pkg: String, text: String, key: String?, sender: String = "Ammi") = Capture(
    pkg = pkg, appLabel = "App", sender = sender, senderKey = "$pkg:$sender", conversation = "chat", conversationKey = key,
    title = sender, text = text, postedAt = now, hash = "$pkg|$key|$text", deletedPlaceholder = false,
  )

  private fun store(picked: Set<String>, vararg c: Capture, otp: Set<String> = emptySet(), fast: Set<String> = emptySet()): MemoryItemStore {
    val s = MemoryItemStore()
    s.setMeta(AiMeta.SINCE, (now - 1).toString())
    s.setMeta(AUTOPILOT_META, AutopilotSettings(pickedChats = picked).toJson())
    c.forEach { x -> s.enqueueAi(s.insert(x, "", if (x.text in otp) now + 300_000 else null)!!, now, x.text in fast) }
    return s
  }

  private fun MemoryItemStore.texts(fastOnly: Boolean = false) = queued(10, fastOnly).map { it.text }

  @Test fun aPickedWhatsAppChatIsQueuedAndAnUnpickedOneIsNot() {
    val s = store(setOf("k1"), cap("com.whatsapp", "hi", "k1"), cap("com.whatsapp", "hello", "k2"))
    assertEquals(listOf("hi"), s.texts())
  }

  @Test fun withNoPickedChatsR44IsUnchanged() {
    val s = store(emptySet(), cap("com.whatsapp", "hi", "k1"), cap("com.google.android.apps.messaging", "sms", "k2"))
    assertEquals(listOf("sms"), s.texts())
  }

  @Test fun aPickedChatOtpIsStillExcluded() {
    val s = store(setOf("k1"), cap("com.whatsapp", "123456", "k1"), cap("com.whatsapp", "hi", "k1"), otp = setOf("123456"))
    assertEquals(listOf("hi"), s.texts())
  }

  @Test fun aPickedChatWithRecordingOffOrBlockedIsStillExcluded() {
    val s = store(
      setOf("k1", "k2", "k3"),
      cap("org.telegram.messenger", "recording off", "k1"), cap("com.whatsapp", "blocked sender", "k2", "Bob"), cap("com.whatsapp", "fine", "k3", "Cy"),
    )
    s.putAppSetting(AppSetting("org.telegram.messenger", "T", record = false, keepDays = null))
    s.aiBlocks += "sender:com.whatsapp:Bob"
    assertEquals(listOf("fine"), s.texts())
    s.aiBlocks += "app:com.whatsapp"
    assertEquals(emptyList<String>(), s.texts())
  }

  @Test fun fastOnlyReturnsTheFastRowsAndTheBatchTakesAll() {
    val s = store(setOf("k1"), cap("com.whatsapp", "hi", "k1"), cap("com.whatsapp", "later", "k1", "Dee"), fast = setOf("hi"))
    assertEquals(listOf("hi"), s.texts(fastOnly = true))
    assertEquals(listOf("hi", "later"), s.texts())
  }
}
