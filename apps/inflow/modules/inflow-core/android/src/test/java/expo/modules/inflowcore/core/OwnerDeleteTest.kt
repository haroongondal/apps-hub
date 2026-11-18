package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

// The owner deleting one message or a whole conversation: gone for good, whatever re-reads the inbox or the mailbox.
class OwnerDeleteTest {
  private val pkg = "com.google.android.apps.messaging"
  private val min = 60_000L
  private var clock = 1_700_000_000_000L
  private val store = MemoryItemStore()
  private val ingest = Ingest(store, "com.haroon.inflow", { clock })

  private fun sms(body: String, address: String = "Alfalah", at: Long = clock) = RawSms(address, body, at, at)

  private fun email(id: String = "<m1>") = RawEmail(id, "Bank Alfalah", "email.notification@bankalfalah.com", "Transaction Successful", Samples.ALFALAH_EMAIL, clock + min)

  private fun idOf(body: String) = store.items.values.first { it.capture.text == body }.id

  @Test fun aDeletedSmsIsNotImportedAgain() {
    ingest.onSms(sms("Your parcel is out for delivery"), pkg, "Messages")
    assertEquals(1, ingest.onSms(sms("Lunch at 1?", address = "Ali"), pkg, "Messages"))
    assertTrue(store.deleteItem(idOf("Your parcel is out for delivery")))
    assertEquals(0, ingest.onSms(sms("Your parcel is out for delivery"), pkg, "Messages"))   // the next inbox sync
    assertEquals(listOf("Lunch at 1?"), store.items.values.map { it.capture.text })
  }

  @Test fun theSameWordsLaterAreANewMessage() {
    ingest.onSms(sms("Your balance is low"), pkg, "Messages")
    store.deleteItem(idOf("Your balance is low"))
    clock += 60 * min
    assertEquals(1, ingest.onSms(sms("Your balance is low", at = clock), pkg, "Messages"))
  }

  @Test fun anSmsThatMergedWithItsNotificationIsBlockedByItsSmsHash() {
    val raw = RawNotification(
      pkg = pkg, appLabel = "Messages", key = "0|$pkg|1|null|10001", postTime = clock, ongoing = false, groupSummary = false,
      title = "Alfalah", text = "Statement ready", bigText = null, subText = null, conversationTitle = null, isGroupConversation = false,
      messages = emptyList(), textLines = emptyList(),
    )
    ingest.onNotification(raw)
    ingest.onSms(sms("Statement ready", at = clock + min), pkg, "Messages")   // the twin takes the SMS hash
    assertNotNull(store.items.values.single().smsHash)
    assertTrue(store.deleteItem(store.items.values.single().id))
    assertEquals(0, ingest.onSms(sms("Statement ready", at = clock + min), pkg, "Messages"))
    assertTrue(store.items.isEmpty())
  }

  @Test fun aDeletedEmailIsNotReadAgainAndItsAiAndTodosGo() {
    assertEquals(1, ingest.onEmail(email(), "Gmail"))
    val id = store.items.values.single().id
    store.enqueueAi(id, clock)
    store.aiResults[id] = AiResult(id, Kind.OTHER, "x", Importance.NORMAL, null, emptyList(), emptyList())
    store.todos += id to AiTodo("Pay the card", null)
    assertTrue(store.deleteItem(id))
    assertTrue(store.queue.isEmpty() && store.aiResults.isEmpty() && store.todos.isEmpty())
    assertEquals(0, ingest.onEmail(email(), "Gmail"))   // a reconnect resets the cursors and reads the mailbox again
    assertTrue(store.items.isEmpty())
  }

  @Test fun deletingAnItemThatIsAlreadyGoneIsAHarmlessFalse() {
    ingest.onSms(sms("Hello"), pkg, "Messages")
    val id = idOf("Hello")
    assertTrue(store.deleteItem(id))
    assertFalse(store.deleteItem(id))
    assertFalse(store.deleteItem(9_999))
  }

  @Test fun deletingAConversationTakesEveryMessageOfIt() {
    ingest.onSms(sms("one", address = "Ali"), pkg, "Messages")
    ingest.onSms(sms("two", address = "Ali", at = clock + min), pkg, "Messages")
    ingest.onSms(sms("three", address = "Sara"), pkg, "Messages")
    val ali = store.items.values.first { it.capture.text == "one" }.capture.conversationKey!!
    assertEquals(2, store.deleteConversation(ali))
    assertEquals(listOf("three"), store.items.values.map { it.capture.text })
    assertEquals(0, ingest.onSms(sms("one", address = "Ali"), pkg, "Messages"))
    assertEquals(0, store.deleteConversation(ali))
  }
}
