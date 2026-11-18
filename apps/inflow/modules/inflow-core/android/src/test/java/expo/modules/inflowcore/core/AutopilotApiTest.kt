package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Test

class AutopilotApiTest {
  @Test fun aSuggestionRowHasTheContractKeysWithLowercaseKindAndState() {
    val s = Suggestion(7, SuggestionKind.MONEY, "Unusual payment", 3, null, "money:1", SuggestionState.WAITING, 10, 11, 99)
    val row = s.toRow()
    // Keys of SuggestionRow in packages/autopilot-contract/src/index.ts, in order.
    assertEquals(listOf("id", "kind", "title", "item_id", "due_at", "state", "created_at", "expires_at"), row.keys.toList())
    assertEquals("money", row["kind"]); assertEquals("waiting", row["state"]); assertEquals(null, row["due_at"]); assertEquals(99L, row["expires_at"])
  }

  @Test fun settingsMapRoundTripsThroughFromMap() {
    val s = AutopilotSettings(
      kinds = setOf(SuggestionKind.MONEY, SuggestionKind.REPLY), surprise = MoneySurpriseConfig(5, 100, 9_000),
      pickedChats = setOf("com.whatsapp|num:1", "org.telegram.messenger|chat:2"), lookIn = setOf("b", "a"), bankApp = "com.bank", alarmBefore = true,
    )
    val m = s.toMap()
    assertEquals(listOf("reply", "money"), m["kinds"])
    assertEquals(s, AutopilotSettingsInput.fromMap(m))
    assertEquals(AutopilotSettings(), AutopilotSettingsInput.fromMap(AutopilotSettings().toMap()))
    assertEquals(AutopilotSettings(kinds = emptySet()), AutopilotSettingsInput.fromMap(AutopilotSettings(kinds = emptySet()).toMap()))
  }

  @Test fun fromMapTakesJsNumbersAndBadValuesFallBack() {
    // Expo hands a JS number over as a Double.
    val ok = AutopilotSettingsInput.fromMap(mapOf("multiple" to 4.0, "minMinor" to 1_000_000.0, "hugeMinor" to 0.0))
    assertEquals(MoneySurpriseConfig(4, 1_000_000, 0), ok.surprise)
    val bad = AutopilotSettingsInput.fromMap(mapOf("multiple" to 0.0, "minMinor" to -1.0, "hugeMinor" to 2.5, "kinds" to listOf("bill", "NOPE", 3), "bankApp" to 5, "alarmBefore" to "yes"))
    assertEquals(MoneySurpriseConfig(), bad.surprise)
    assertEquals(setOf(SuggestionKind.BILL), bad.kinds)
    assertEquals(null, bad.bankApp); assertEquals(false, bad.alarmBefore)
    assertEquals(MoneySurpriseConfig(), AutopilotSettingsInput.fromMap(mapOf("multiple" to 1001.0, "minMinor" to Double.NaN)).surprise)
  }

  @Test fun aPickedChatWithoutAPipeIsDropped() {
    val s = AutopilotSettingsInput.fromMap(mapOf("pickedChats" to arrayOf("com.whatsapp|num:1", "num:1", "", "|")))
    assertEquals(setOf("com.whatsapp|num:1", "|"), s.pickedChats)   // "|" has a pipe: shape is all this checks; it matches no conversation
    assertEquals(emptySet<String>(), AutopilotSettingsInput.fromMap(mapOf("pickedChats" to "x")).pickedChats)
  }

  @Test fun anyOtherShapeIsDefaults() {
    assertEquals(AutopilotSettings(), AutopilotSettingsInput.fromMap(emptyMap()))
    assertEquals(AutopilotSettings(), AutopilotSettingsInput.fromMap(mapOf("kinds" to mapOf("a" to 1), "lookIn" to 4)))
  }
}
