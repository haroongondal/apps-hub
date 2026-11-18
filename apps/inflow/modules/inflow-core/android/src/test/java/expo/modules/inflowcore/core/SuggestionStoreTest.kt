package expo.modules.inflowcore.core

import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// SqlSuggestionStore has no JVM harness (no SQLCipher here, R32): its SQL is run in sqlite3 by hand over this same scenario.
class SuggestionStoreTest {
  private val store: SuggestionStore = MemorySuggestionStore()
  private val t0 = 1_800_000_000_000L

  private fun s(key: String = "reply:a", kind: SuggestionKind = SuggestionKind.REPLY, expiresAt: Long = t0 + 1_000, createdAt: Long = t0) =
    Suggestion(0, kind, "Reply to Ali", 1, null, key, SuggestionState.WAITING, createdAt, createdAt, expiresAt)

  @Test fun sameKeyTwiceGivesOneRow() {
    assertNotNull(store.add(s()))
    assertNull(store.add(s()))
    assertEquals(1, store.waiting().size)
  }

  @Test fun aStartedRowAlsoBlocksTheKey() {
    val id = store.add(s())!!
    assertTrue(store.setState(id, SuggestionState.STARTED, t0))
    assertNull(store.add(s()))
  }

  @Test fun aFinishedRowDoesNotBlockANewOne() {
    val id = store.add(s())!!
    assertTrue(store.setState(id, SuggestionState.DONE, t0))
    assertNotNull(store.add(s()))
  }

  @Test fun differentKeysAreDifferentRows() {
    assertNotNull(store.add(s("reply:a")))
    assertNotNull(store.add(s("reply:b")))
    assertEquals(2, store.waiting().size)
  }

  @Test fun getReturnsTheRowWithItsId() {
    val id = store.add(s())!!
    assertEquals(id, store.get(id)!!.id)
    assertEquals("reply:a", store.get(id)!!.dedupeKey)
    assertNull(store.get(id + 99))
  }

  @Test fun setStateOnAnUnknownIdIsFalse() = assertFalse(store.setState(42, SuggestionState.SKIPPED, t0))

  @Test fun aFinalStateNeverGoesBack() {
    for (final in listOf(SuggestionState.EXPIRED, SuggestionState.SKIPPED, SuggestionState.DONE)) {
      val id = store.add(s("k$final"))!!
      assertTrue(store.setState(id, final, t0 + 1))
      assertFalse(store.setState(id, SuggestionState.WAITING, t0 + 2))
      assertFalse(store.setState(id, SuggestionState.STARTED, t0 + 2))
      assertFalse(store.setState(id, SuggestionState.DONE, t0 + 2))
      assertEquals(final, store.get(id)!!.state)
      assertEquals(t0 + 1, store.get(id)!!.updatedAt)
    }
  }

  @Test fun runningTwiceStartsOnce() {
    val id = store.add(s())!!
    assertTrue(store.setState(id, SuggestionState.STARTED, t0))
    assertFalse(store.setState(id, SuggestionState.STARTED, t0))
    assertTrue(store.setState(id, SuggestionState.DONE, t0))
  }

  @Test fun expireFlipsWaitingAndStartedPastTheirTimeAndCounts() {
    val a = store.add(s("a", expiresAt = t0 + 10))!!
    val b = store.add(s("b", expiresAt = t0 + 10))!!
    val c = store.add(s("c", expiresAt = t0 + 100))!!
    val d = store.add(s("d", expiresAt = t0 + 10))!!
    store.setState(b, SuggestionState.STARTED, t0)
    store.setState(d, SuggestionState.SKIPPED, t0)
    assertEquals(2, store.expire(t0 + 10))   // expiresAt <= now counts
    assertEquals(SuggestionState.EXPIRED, store.get(a)!!.state)
    assertEquals(SuggestionState.EXPIRED, store.get(b)!!.state)
    assertEquals(SuggestionState.WAITING, store.get(c)!!.state)
    assertEquals(SuggestionState.SKIPPED, store.get(d)!!.state)
    assertEquals(0, store.expire(t0 + 10))
  }

  @Test fun closeRepliesFlipsWaitingRepliesOfThatKeyOnly() {
    val a = store.add(s("reply:p|a"))!!
    val b = store.add(s("reply:p|b"))!!
    val bill = store.add(s("bill:1:2026-12-01", SuggestionKind.BILL))!!
    assertEquals(1, store.closeReplies("p", "a", t0 + 5))
    assertEquals(SuggestionState.EXPIRED, store.get(a)!!.state)
    assertEquals(SuggestionState.WAITING, store.get(b)!!.state)
    assertEquals(SuggestionState.WAITING, store.get(bill)!!.state)
    assertEquals(0, store.closeReplies("p", "a", t0 + 6))
  }

  // Number chats share one conversation key (num:...) across apps, so the package is part of the reply key.
  private fun replyFor(pkg: String, key: String = "num:3001234567") = AiResult(5, Kind.MESSAGE, "x", Importance.NORMAL, null, emptyList(), emptyList(), AiSuggest(SuggestType.REPLY, null, "asks"))
    .let { r -> AiInput(5, "App", "Ali", null, "text", t0, "Ali", false, key, pkg) to r }

  @Test fun aWhatsAppAndAnSmsReplyToTheSameNumberAreTwoSuggestions() {
    val hook = suggestionHook(store, { AutopilotSettings() }, { t0 }, ZoneId.of("Asia/Karachi"))
    for (pkg in listOf("com.whatsapp", "com.google.android.apps.messaging")) replyFor(pkg).let { (i, r) -> hook(r, i) }
    assertEquals(setOf("reply:com.whatsapp|num:3001234567", "reply:com.google.android.apps.messaging|num:3001234567"), store.waiting().map { it.dedupeKey }.toSet())
  }

  @Test fun anOwnMessageInSignalExpiresOnlyTheSignalReply() {
    val hook = suggestionHook(store, { AutopilotSettings() }, { t0 }, ZoneId.of("Asia/Karachi"))
    for (pkg in listOf("com.whatsapp", "org.thoughtcrime.securesms")) replyFor(pkg).let { (i, r) -> hook(r, i) }
    assertEquals(1, store.closeReplies("org.thoughtcrime.securesms", "num:3001234567", t0 + 1))
    assertEquals(listOf("reply:com.whatsapp|num:3001234567"), store.waiting().map { it.dedupeKey })
  }

  @Test fun listFiltersByStateNewestFirstWithALimit() {
    val a = store.add(s("a", createdAt = t0))!!
    val b = store.add(s("b", createdAt = t0 + 1))!!
    val c = store.add(s("c", createdAt = t0 + 2))!!
    store.setState(a, SuggestionState.DONE, t0)
    assertEquals(listOf(c, b), store.waiting().map { it.id })
    assertEquals(listOf(c), store.list(setOf(SuggestionState.WAITING), 1).map { it.id })
    assertEquals(listOf(a), store.list(setOf(SuggestionState.DONE, SuggestionState.SKIPPED), 10).map { it.id })
  }

  @Test fun theHookStoresAReplySuggestionForAnOwnerKind() {
    val hook = suggestionHook(store, { AutopilotSettings() }, { t0 }, ZoneId.of("Asia/Karachi"))
    val r = AiResult(5, Kind.MESSAGE, "x", Importance.NORMAL, null, emptyList(), emptyList(), AiSuggest(SuggestType.REPLY, null, "asks"))
    hook(r, AiInput(5, "App", "Ali", null, "text", t0, "Ali", false, "wa:ali", "com.whatsapp"))
    hook(r, AiInput(5, "App", "Ali", null, "text", t0, "Ali", false, "wa:ali", "com.whatsapp"))
    assertEquals(listOf("reply:com.whatsapp|wa:ali"), store.waiting().map { it.dedupeKey })
  }
}
