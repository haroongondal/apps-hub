package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NotifiedTest {
  @Test
  fun addsToEmpty() {
    assertEquals("a", Notified.add("", "a"))
    assertEquals(listOf("a"), Notified.parse("a"))
    assertEquals(emptyList<String>(), Notified.parse(""))
  }

  @Test
  fun mostRecentLastAndUnchangedWhenAlreadyLast() {
    assertEquals("b\na", Notified.add("a\nb", "a"))
    assertNull(Notified.add("a\nb", "b"))
  }

  @Test
  fun capDropsTheEldest() {
    var s = ""
    for (i in 0 until 600) s = Notified.add(s, "p$i") ?: s
    val list = Notified.parse(s)
    assertEquals(500, list.size)
    assertEquals("p100", list.first())
    assertEquals("p599", list.last())
  }
}
