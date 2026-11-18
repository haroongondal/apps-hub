package expo.modules.notchisland.core

import org.junit.Assert.assertEquals
import org.junit.Test

class NotchSettingsTest {
  @Test fun nullOrBlankGivesDefaults() {
    assertEquals(NotchSettings.DEFAULTS, NotchSettings.parse(null))
    assertEquals(NotchSettings.DEFAULTS, NotchSettings.parse("  "))
  }

  @Test fun invalidJsonGivesDefaults() {
    assertEquals(NotchSettings.DEFAULTS, NotchSettings.parse("{not json"))
  }

  @Test fun unknownValueFallsBackPerField() {
    val s = NotchSettings.parse("""{"accent":"neon","size":"large"}""")
    assertEquals("large", s.size)
    assertEquals(NotchSettings.DEFAULTS.accent, s.accent)
  }

  @Test fun unknownAndRepeatedWidgetsDropped() {
    val s = NotchSettings.parse("""{"widgets":["battery","nope","battery"]}""")
    assertEquals(listOf("battery"), s.widgets)
  }

  @Test fun roundTripKeepsValues() {
    val s = NotchSettings.DEFAULTS.copy(size = "large", foldMs = 0, widgets = listOf("battery", "clock"))
    assertEquals(s, NotchSettings.parse(s.toJson()))
  }
}
