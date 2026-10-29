package expo.modules.deputyagent.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class TrustTableTest {
  private val self = "com.haroon.deputy"
  private val bank = "com.meezanbank.mobile"
  private fun table(vararg o: Pair<String, TrustLevel>) = TrustTable(self, o.toMap())

  @Test fun theOwnersChoiceWinsOverTheDefault() {
    val t = table("com.whatsapp" to TrustLevel.BLOCKED, bank to TrustLevel.STANDARD)
    assertEquals(TrustLevel.BLOCKED, t.level("com.whatsapp"))
    assertEquals(TrustLevel.STANDARD, t.level(bank))
    assertEquals(TrustLevel.STANDARD, t.level("com.google.android.gm"))
  }

  @Test fun deputyStaysBlockedWhateverIsStored() {
    assertEquals(TrustLevel.BLOCKED, table(self to TrustLevel.STANDARD).level(self))
    assertThrows(IllegalArgumentException::class.java) { table().set(self, TrustLevel.STANDARD, "Deputy", null) }
  }

  @Test fun aMoneyAppNeedsItsNameTypedToBecomeStandard() {
    val e = assertThrows(IllegalArgumentException::class.java) { table().set(bank, TrustLevel.STANDARD, "Meezan Bank", "yes") }
    assertTrue(e.message!!.contains("Meezan Bank"))
    assertThrows(IllegalArgumentException::class.java) { table().set(bank, TrustLevel.STANDARD, "Meezan Bank", null) }
    assertEquals(mapOf(bank to TrustLevel.STANDARD), table().set(bank, TrustLevel.STANDARD, "Meezan Bank", " meezan bank "))
  }

  @Test fun aMoneyAppNeedsNoTypingToBecomeStricter() {
    assertEquals(mapOf(bank to TrustLevel.BLOCKED), table().set(bank, TrustLevel.BLOCKED, "Meezan Bank", null))
  }

  @Test fun otherAppsChangeWithoutTyping() {
    assertEquals(mapOf("com.whatsapp" to TrustLevel.READ_ONLY), table().set("com.whatsapp", TrustLevel.READ_ONLY, "WhatsApp", null))
  }

  @Test fun goingBackToTheDefaultDropsTheOverride() {
    assertEquals(emptyMap<String, TrustLevel>(), table(bank to TrustLevel.BLOCKED).set(bank, TrustLevel.READ_ONLY, "Meezan Bank", null))
  }

  @Test fun flagsMoneyAppsByTheirDefault() {
    assertTrue(table(bank to TrustLevel.STANDARD).financial(bank))
    assertFalse(table().financial("com.whatsapp"))
  }
}
