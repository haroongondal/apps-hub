package expo.modules.strongroomvault.android

import expo.modules.strongroomvault.core.ExpiryIndex
import expo.modules.strongroomvault.core.ExpiryItem
import java.time.LocalDate
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Binds the provider's columns, authority and row cap to EXPIRY_SHARE (apps/strongroom/src/expiry-share.ts), which expiry-share.test.ts pins to the same file. */
class ExpiryLinkProviderShareTest {
  private fun json(name: String) = Json.parseToJsonElement(javaClass.getResourceAsStream("/$name")!!.readBytes().decodeToString())

  private val share = json("expiry.share.json").jsonObject

  @Test fun theRowColumnsEqualTheShareColumnsInOrder() =
    assertEquals(share.getValue("columns").jsonArray.map { it.jsonPrimitive.content }, ExpiryLinkProvider.ROW_COLUMNS.toList())

  @Test fun theAuthorityAndPathEqualTheShare() {
    assertEquals(share.getValue("authority").jsonPrimitive.content, ExpiryLinkProvider.AUTHORITY)
    assertEquals(share.getValue("path").jsonPrimitive.content, ExpiryLinkProvider.PATH)
  }

  @Test fun theListLimitIsWithinTheShareRowCap() = assertTrue(ExpiryLinkProvider.LIST_LIMIT <= share.getValue("maxRows").jsonPrimitive.int)

  @Test fun aRowHasOneValueOfTheSampleShapePerColumn() {
    val sample = json("expiry-rows.sample.json").jsonArray.map { it.jsonObject }
    val today = LocalDate.of(2026, 11, 23)
    for (s in sample) {
      val item = ExpiryItem(s.text("kind"), s.text("label"), LocalDate.parse(s.text("expires_on")))
      val row = ExpiryIndex.row(item, today)
      assertEquals(ExpiryLinkProvider.ROW_COLUMNS.size, row.size)
      assertEquals(listOf(s.text("kind"), s.text("label"), s.text("expires_on"), s.getValue("days_left").jsonPrimitive.long), row.toList())
    }
  }

  private fun JsonObject.text(k: String) = getValue(k).jsonPrimitive.content
}
