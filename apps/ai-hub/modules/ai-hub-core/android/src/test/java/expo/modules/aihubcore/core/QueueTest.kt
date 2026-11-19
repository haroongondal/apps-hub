package expo.modules.aihubcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueTest {
  private fun item(id: String, p: Priority = Priority.BACKGROUND, s: String = "groq") = QueueItem(id, s, p)

  @Test fun foregroundBeforeBackground() {
    val q = Queue(limit = 1)
    q.enqueue(item("bg"))
    q.enqueue(item("fg", Priority.FOREGROUND))
    assertEquals("fg", q.next(0)?.id)
  }

  @Test fun fifoWithinPriority() {
    val q = Queue(limit = 5)
    listOf("a", "b", "c").forEach { q.enqueue(item(it)) }
    assertEquals(listOf("a", "b", "c"), List(3) { q.next(0)?.id })
  }

  @Test fun concurrencyLimitPerService() {
    val q = Queue()
    listOf("a", "b", "c").forEach { q.enqueue(item(it)) }
    q.enqueue(item("g", s = "gemini"))
    val a = q.next(0)!!
    assertEquals("b", q.next(0)?.id)
    assertEquals("g", q.next(0)?.id)
    assertNull(q.next(0))
    q.done(a)
    assertEquals("c", q.next(0)?.id)
  }

  @Test fun retryAfterHoldsUntilExactBoundary() {
    val q = Queue()
    q.enqueue(item("a"))
    q.onLimited("groq", 5_000, 1_000)
    assertEquals(6_000L, q.heldUntil("groq"))
    assertNull(q.next(5_999))
    assertEquals("a", q.next(6_000)?.id)
  }

  @Test fun holdDefaultsToTenSecondsAndOnlyBlocksThatService() {
    val q = Queue()
    q.enqueue(item("a"))
    q.enqueue(item("g", s = "gemini"))
    q.onLimited("groq", null, 0)
    assertEquals(10_000L, q.heldUntil("groq"))
    assertEquals("g", q.next(0)?.id)
    assertNull(q.next(9_999))
  }

  @Test fun shorterHoldDoesNotShortenALongerOne() {
    val q = Queue()
    q.onLimited("groq", 20_000, 0)
    q.onLimited("groq", 1_000, 0)
    assertEquals(20_000L, q.heldUntil("groq"))
  }

  @Test fun cancelRemovesQueuedItemOnly() {
    val q = Queue(limit = 1)
    q.enqueue(item("a"))
    q.enqueue(item("b"))
    val a = q.next(0)!!
    assertTrue(q.cancel("b"))
    assertFalse(q.cancel("a"))
    q.done(a)
    assertNull(q.next(0))
  }
}
