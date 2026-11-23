package expo.modules.deputyagent.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class RunSuggestionActivityTest {
  private val rows = mapOf(
    "suggestions/7" to mapOf("item_id" to "42"),
    "items/42" to mapOf("app" to "WhatsApp", "pkg" to "com.whatsapp", "conversation" to "", "sender" to "Sam", "text" to "hi"),
  )

  @Test fun readsBothRowsWhenInflowIsTrusted() {
    val item = RunSuggestionActivity.readItem(7, { true }) { rows[it] }
    assertNotNull(item)
    assertEquals("Sam", item!!.name)
    assertEquals("hi", item.text)
  }

  @Test fun refusesWithoutQueryingWhenNotTrusted() {
    val queried = mutableListOf<String>()
    assertNull(RunSuggestionActivity.readItem(7, { false }) { queried += it; rows[it] })
    assertEquals(emptyList<String>(), queried)
  }

  @Test fun asksBeforeEachQueryAndStopsIfTrustIsLostBetweenThem() {
    var asks = 0
    val queried = mutableListOf<String>()
    assertNull(RunSuggestionActivity.readItem(7, { ++asks == 1 }) { queried += it; rows[it] })
    assertEquals(2, asks)
    assertEquals(listOf("suggestions/7"), queried)
  }
}
