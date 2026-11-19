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

  @Test fun eventsDefaultOnAndFallBackPerSwitch() {
    assertEquals(EventSwitches(true, true, true), NotchSettings.DEFAULTS.events)
    assertEquals(EventSwitches(true, true, true), NotchSettings.parse("""{"accent":"mint"}""").events)
    val s = NotchSettings.parse("""{"events":{"charging":false,"ringer":"no","dnd":1}}""")
    assertEquals(EventSwitches(charging = false, ringer = true, dnd = true), s.events)
    assertEquals(EventSwitches(true, true, true), NotchSettings.parse("""{"events":[false]}""").events)
  }

  @Test fun eventsRoundTrip() {
    val s = NotchSettings.DEFAULTS.copy(events = EventSwitches(charging = false, ringer = true, dnd = false))
    assertEquals(s, NotchSettings.parse(s.toJson()))
  }
}
