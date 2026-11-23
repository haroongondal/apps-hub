package expo.modules.notchisland.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagePeekTest {
  private val on = MessagePeekSettings(on = true, apps = listOf("com.whatsapp", "com.example.chat"))
  private fun msg(key: String = "k", at: Long = 1_000, line: String = "On my way", pkg: String = "com.whatsapp") = MessageSnapshot(key, pkg, "Sam", line, at)

  @Test fun onlyAllowedNonOngoingMessages() {
    assertTrue(MessagePeek.qualifies("com.example.chat", false, "msg", false, on))
    assertFalse(MessagePeek.qualifies("com.example.chat", true, "msg", false, on))
    assertFalse(MessagePeek.qualifies("com.example.chat", false, "msg", true, on))
    assertFalse(MessagePeek.qualifies("com.other", false, "msg", false, on))
    assertFalse(MessagePeek.qualifies("com.example.chat", false, "msg", false, on.copy(on = false)))
    assertFalse(MessagePeek.qualifies("com.example.chat", false, "email", false, on))
  }

  @Test fun aMissingCategoryCountsOnlyForKnownMessagingApps() {
    assertTrue(MessagePeek.qualifies("com.whatsapp", false, null, false, on))
    assertFalse(MessagePeek.qualifies("com.example.chat", false, null, false, on))
    assertFalse(MessagePeek.qualifies("com.whatsapp", false, "call", false, on))
  }

  @Test fun theDefaultIsOffAndEmpty() {
    assertFalse(MessagePeekSettings().on)
    assertTrue(MessagePeekSettings().apps.isEmpty())
    assertFalse(MessagePeek.qualifies("com.whatsapp", false, "msg", false, MessagePeekSettings()))
  }

  @Test fun theLineIsOneLineOfAtMost60Characters() {
    assertEquals("Hi there how are you", MessagePeek.line("Hi there\n  how\tare you "))
    val long = "a".repeat(100)
    val cut = MessagePeek.line(long)
    assertEquals(60, cut.length)
    assertTrue(cut.endsWith("…"))
    assertEquals("x".repeat(60), MessagePeek.line("x".repeat(60)))
    assertEquals("", MessagePeek.line(null))
  }

  @Test fun theCutNeverSplitsAnEmoji() {
    val smile = "😀"
    assertEquals("a".repeat(58) + "…", MessagePeek.line("a".repeat(58) + smile + "bbbb"))
    assertEquals("a".repeat(57) + smile + "…", MessagePeek.line("a".repeat(57) + smile + "bbbb"))
  }

  @Test fun noSenderNoRow() {
    assertNull(MessagePeek.snapshot("k", "com.whatsapp", "  ", "Hello", 1))
    assertNull(MessagePeek.snapshot("k", "com.whatsapp", null, "Hello", 1))
    assertEquals(MessageSnapshot("k", "com.whatsapp", "Sam", "", 1), MessagePeek.snapshot("k", "com.whatsapp", "Sam", null, 1))
  }

  @Test fun theNewestWinsAndASameRepostKeepsTheFirst() {
    val a = msg("a", 1_000)
    val b = msg("b", 2_000)
    assertSame(a, MessagePeek.next(null, a))
    assertSame(b, MessagePeek.next(a, b))
    assertSame(b, MessagePeek.next(b, a))
    val repost = msg("a", 5_000)
    assertSame(a, MessagePeek.next(a, repost))
    val newer = msg("a", 5_000, line = "Here now")
    assertSame(newer, MessagePeek.next(a, newer))
  }

  @Test fun showsForEightSecondsAfterPosting() {
    val m = msg(at = 10_000)
    assertEquals(8_000, MessagePeek.remainingMs(m, on, 10_000, 0, false))
    assertEquals(3_000, MessagePeek.remainingMs(m, on, 15_000, 0, false))
    assertEquals(0, MessagePeek.remainingMs(m, on, 18_000, 0, false))
    assertEquals(0, MessagePeek.remainingMs(m, on, 30_000, 0, false))
    // A clock set back never stretches it past 8 s.
    assertEquals(8_000, MessagePeek.remainingMs(m, on, 1_000, 0, false))
  }

  @Test fun hiddenOnceThePillClosesAfterThePost() {
    val m = msg(at = 10_000)
    assertEquals(0, MessagePeek.remainingMs(m, on, 12_000, 11_000, false))
    assertEquals(0, MessagePeek.remainingMs(m, on, 12_000, 10_000, false))
    assertEquals(6_000, MessagePeek.remainingMs(m, on, 12_000, 9_999, false))
  }

  @Test fun neverDuringACallOrWhenNotAllowed() {
    val m = msg(at = 10_000)
    assertEquals(0, MessagePeek.remainingMs(m, on, 11_000, 0, true))
    assertEquals(0, MessagePeek.remainingMs(m, on.copy(on = false), 11_000, 0, false))
    assertEquals(0, MessagePeek.remainingMs(m, on.copy(apps = listOf("com.example.chat")), 11_000, 0, false))
    assertEquals(0, MessagePeek.remainingMs(null, on, 11_000, 0, false))
  }

  @Test fun theRowIs64dp() {
    assertEquals(64, PillGeometry.rowDp("message"))
  }

  @Test fun packagePattern() {
    assertTrue(MessagePeek.PACKAGE.matches("org.telegram.messenger"))
    assertTrue(MessagePeek.PACKAGE.matches("com.whats_app2"))
    assertFalse(MessagePeek.PACKAGE.matches(""))
    assertFalse(MessagePeek.PACKAGE.matches("com.evil/app"))
    assertFalse(MessagePeek.PACKAGE.matches("a".repeat(151)))
  }
}
