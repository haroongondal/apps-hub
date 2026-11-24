package expo.modules.strongroomvault.android

import expo.modules.strongroomvault.core.ExpiryItem
import java.time.LocalDate
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Binds the `health` path to app-health.share.json, a copy of packages/app-link-contract/fixtures/app-health.share.json that app-health-share.test.ts pins byte for byte. */
class AppHealthShareTest {
  private val share = Json.parseToJsonElement(javaClass.getResourceAsStream("/app-health.share.json")!!.readBytes().decodeToString()).jsonObject
  private val today = LocalDate.of(2026, 11, 24)
  private val card = ExpiryItem("card", "Card", LocalDate.of(2027, 1, 31))

  private fun answer(path: String, lastSeen: Long? = null, expiry: List<ExpiryItem> = emptyList()) =
    ExpiryLinkProvider.answer(listOf(path), { lastSeen }, { expiry }, today)

  @Test fun thePathAndColumnsEqualTheShare() {
    assertEquals(share.getValue("path").jsonPrimitive.content, AppHealth.PATH)
    assertEquals(share.getValue("columns").jsonArray.map { it.jsonPrimitive.content }, AppHealth.COLUMNS.toList())
  }

  @Test fun oneRowFitsTheShareCap() = assertEquals(share.getValue("maxRows").jsonPrimitive.int, answer("health").rows.size)

  @Test fun theRowSaysStrongroomHasNoAccessibilityOrListenerAndNoAiSource() {
    val row = answer("health", lastSeen = 1_700_000_000_000L).rows.single()
    assertEquals(AppHealth.COLUMNS.size, row.size)
    assertEquals(listOf("strongroom", null, null, "none", 1_700_000_000_000L), row.toList())
  }

  @Test fun anAppThatNeverRanHasNoHeartbeat() = assertNull(answer("health").rows.single()[4])

  @Test fun healthIsServedWhileTheExpirySwitchIsOff() {
    val off = ExpiryShare.readIf(false) { listOf(card) }
    assertEquals(1, answer("health", expiry = off).rows.size)
    assertTrue(answer("expiry", expiry = off).rows.isEmpty())
  }

  @Test fun theExpiryPathStillServesCardsWhenTheSwitchIsOn() {
    val on = ExpiryShare.readIf(true) { listOf(card) }
    assertEquals(listOf("card", "Card", "2027-01-31", 68L), answer("expiry", expiry = on).rows.single().toList())
    assertEquals(ExpiryLinkProvider.ROW_COLUMNS.toList(), answer("expiry").columns.toList())
  }

  @Test fun healthNeverReadsTheExpiryIndex() {
    ExpiryLinkProvider.answer(listOf("health"), { null }, { throw AssertionError("the expiry index was read") }, today)
  }

  @Test fun anotherPathIsRefused() {
    for (p in listOf(listOf("vault"), listOf("health", "x"), emptyList(), listOf("expiry", "health"))) {
      val refused = runCatching { ExpiryLinkProvider.answer(p, { null }, { emptyList() }, today) }.exceptionOrNull()
      assertTrue(p.toString(), refused is IllegalArgumentException)
    }
    assertFalse(AppHealth.APP_ID.isEmpty())
  }
}
