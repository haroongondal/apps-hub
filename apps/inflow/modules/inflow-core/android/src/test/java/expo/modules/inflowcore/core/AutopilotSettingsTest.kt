package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Test

class AutopilotSettingsTest {
  private val defaults = AutopilotSettings()

  @Test fun defaultsAreAllKindsAndThresholds() {
    assertEquals(SuggestionKind.values().toSet(), defaults.kinds)
    assertEquals(MoneySurpriseConfig(), defaults.surprise)
    assertEquals(emptySet<String>(), defaults.pickedChats)
    assertEquals(null, defaults.bankApp)
    assertEquals(false, defaults.alarmBefore)
  }

  @Test fun garbageGivesDefaults() {
    assertEquals(defaults, AutopilotSettings.fromJson("garbage"))
    assertEquals(defaults, AutopilotSettings.fromJson(""))
    assertEquals(defaults, AutopilotSettings.fromJson(null))
    assertEquals(defaults, AutopilotSettings.fromJson("[1,2]"))
    assertEquals(defaults, AutopilotSettings.fromJson("{}"))
  }

  @Test fun roundTripKeepsEveryField() {
    val s = AutopilotSettings(
      kinds = setOf(SuggestionKind.REPLY, SuggestionKind.MONEY),
      surprise = MoneySurpriseConfig(multiple = 5, minMinor = 100, hugeMinor = 9_000),
      pickedChats = setOf("wa:ali", "wa:team"), lookIn = setOf("com.whatsapp"), bankApp = "com.bank", alarmBefore = true,
    )
    assertEquals(s, AutopilotSettings.fromJson(s.toJson()))
    assertEquals(defaults, AutopilotSettings.fromJson(defaults.toJson()))
    assertEquals(AutopilotSettings(kinds = emptySet()), AutopilotSettings.fromJson(AutopilotSettings(kinds = emptySet()).toJson()))
  }

  @Test fun wrongTypesAndUnknownKindsFallBackPerField() {
    val s = AutopilotSettings.fromJson("""{"kinds":["BILL","NOPE"],"multiple":"x","pickedChats":"a","alarmBefore":1,"bankApp":5}""")
    assertEquals(setOf(SuggestionKind.BILL), s.kinds)
    assertEquals(defaults.surprise, s.surprise)
    assertEquals(emptySet<String>(), s.pickedChats)
    assertEquals(false, s.alarmBefore)
    assertEquals(null, s.bankApp)
  }
}
