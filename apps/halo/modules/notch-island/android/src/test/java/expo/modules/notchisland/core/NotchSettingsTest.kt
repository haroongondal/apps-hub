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
    val s = NotchSettings.parse("""{"events":{"charging":false,"ringer":"false","dnd":1}}""")
    assertEquals(EventSwitches(charging = false, ringer = true, dnd = true), s.events)
    assertEquals(EventSwitches(charging = true, ringer = false, dnd = true), NotchSettings.parse("""{"events":{"ringer":false}}""").events)
    assertEquals(EventSwitches(true, true, true), NotchSettings.parse("""{"events":[false]}""").events)
  }

  @Test fun progressCardsDefaultOnRejectStringsAndRoundTrip() {
    assertEquals(true, NotchSettings.DEFAULTS.progressCards)
    assertEquals(true, NotchSettings.parse("""{"accent":"mint"}""").progressCards)
    assertEquals(false, NotchSettings.parse("""{"progressCards":false}""").progressCards)
    assertEquals(true, NotchSettings.parse("""{"progressCards":"false"}""").progressCards)
    assertEquals(true, NotchSettings.parse("""{"progressCards":0}""").progressCards)
    val s = NotchSettings.DEFAULTS.copy(progressCards = false)
    assertEquals(s, NotchSettings.parse(s.toJson()))
  }

  @Test fun alarmCardDefaultsOnRejectsStringsAndRoundTrips() {
    assertEquals(true, NotchSettings.DEFAULTS.alarmCard)
    assertEquals(true, NotchSettings.parse("""{"accent":"mint"}""").alarmCard)
    assertEquals(false, NotchSettings.parse("""{"alarmCard":false}""").alarmCard)
    assertEquals(true, NotchSettings.parse("""{"alarmCard":"false"}""").alarmCard)
    assertEquals(true, NotchSettings.parse("""{"alarmCard":0}""").alarmCard)
    val s = NotchSettings.DEFAULTS.copy(alarmCard = false)
    assertEquals(s, NotchSettings.parse(s.toJson()))
  }

  @Test fun eventsRoundTrip() {
    val s = NotchSettings.DEFAULTS.copy(events = EventSwitches(charging = false, ringer = true, dnd = false))
    assertEquals(s, NotchSettings.parse(s.toJson()))
  }

  @Test fun bluetoothSwitchDefaultsOnRejectsStringsAndRoundTrips() {
    assertEquals(true, NotchSettings.DEFAULTS.events.bluetooth)
    assertEquals(true, NotchSettings.parse("""{"events":{"dnd":false}}""").events.bluetooth)
    assertEquals(false, NotchSettings.parse("""{"events":{"bluetooth":false}}""").events.bluetooth)
    assertEquals(true, NotchSettings.parse("""{"events":{"bluetooth":"false"}}""").events.bluetooth)
    val s = NotchSettings.DEFAULTS.copy(events = EventSwitches(bluetooth = false))
    assertEquals(s, NotchSettings.parse(s.toJson()))
  }

  @Test fun messagePeekDefaultsOffAndEmpty() {
    assertEquals(MessagePeekSettings(false, emptyList()), NotchSettings.DEFAULTS.messagePeek)
    assertEquals(MessagePeekSettings(), NotchSettings.parse("""{"accent":"mint"}""").messagePeek)
    assertEquals(MessagePeekSettings(), NotchSettings.parse("""{"messagePeek":[true]}""").messagePeek)
  }

  @Test fun messagePeekFieldsFallBackOnTheirOwn() {
    assertEquals(MessagePeekSettings(true, emptyList()), NotchSettings.parse("""{"messagePeek":{"on":true,"apps":"com.whatsapp"}}""").messagePeek)
    assertEquals(MessagePeekSettings(false, listOf("com.whatsapp")), NotchSettings.parse("""{"messagePeek":{"on":"true","apps":["com.whatsapp"]}}""").messagePeek)
    assertEquals(false, NotchSettings.parse("""{"messagePeek":{"on":1}}""").messagePeek.on)
  }

  @Test fun messagePeekAppsKeepOnlyValidUniquePackageNamesUpTo20() {
    val apps = NotchSettings.parse(
      """{"messagePeek":{"on":true,"apps":["com.whatsapp",1,null,true,"com.whatsapp","bad/pkg","","${"a".repeat(151)}","org.telegram.messenger"]}}""",
    ).messagePeek.apps
    assertEquals(listOf("com.whatsapp", "org.telegram.messenger"), apps)
    val many = (1..25).joinToString(",") { "\"com.app$it\"" }
    val capped = NotchSettings.parse("""{"messagePeek":{"apps":[$many]}}""").messagePeek.apps
    assertEquals(20, capped.size)
    assertEquals("com.app1", capped.first())
  }

  @Test fun messagePeekRoundTrips() {
    val s = NotchSettings.DEFAULTS.copy(messagePeek = MessagePeekSettings(true, listOf("com.whatsapp", "org.telegram.messenger")))
    assertEquals(s, NotchSettings.parse(s.toJson()))
  }
}
