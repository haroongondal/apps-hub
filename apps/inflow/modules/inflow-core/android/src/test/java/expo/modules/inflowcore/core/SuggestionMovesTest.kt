package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SuggestionMovesTest {
  private val store = MemorySuggestionStore()
  private val t0 = 1_800_000_000_000L

  private fun add(expiresAt: Long, key: String = "reply:a") =
    store.add(Suggestion(0, SuggestionKind.REPLY, "Reply to Ali", 1, null, key, SuggestionState.WAITING, t0, t0, expiresAt))!!

  @Test fun anExpiredButUnsweptRowCannotStart() {
    val id = add(expiresAt = t0 + 1_000)
    assertFalse(SuggestionMoves.move(store, id, SuggestionState.STARTED, t0 + 1_000))
    assertEquals(SuggestionState.EXPIRED, store.get(id)!!.state)
  }

  @Test fun aLiveRowStartsOnceAndNotTwice() {
    val id = add(expiresAt = t0 + 1_000)
    assertTrue(SuggestionMoves.move(store, id, SuggestionState.STARTED, t0))
    assertFalse(SuggestionMoves.move(store, id, SuggestionState.STARTED, t0 + 1))
    assertEquals(SuggestionState.STARTED, store.get(id)!!.state)
  }

  @Test fun aDoneRowNeverStartsAgain() {
    val id = add(expiresAt = t0 + 1_000)
    assertTrue(SuggestionMoves.move(store, id, SuggestionState.STARTED, t0))
    assertTrue(SuggestionMoves.move(store, id, SuggestionState.DONE, t0 + 1))
    assertFalse(SuggestionMoves.move(store, id, SuggestionState.STARTED, t0 + 2))
    assertEquals(SuggestionState.DONE, store.get(id)!!.state)
  }

  @Test fun anUnknownIdMovesNothing() = assertFalse(SuggestionMoves.move(store, 99, SuggestionState.SKIPPED, t0))
}
