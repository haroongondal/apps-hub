package expo.modules.haloengine.core

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HaloHealthTest {
  private val share = Json.parseToJsonElement(File("../../../../../packages/app-link-contract/fixtures/app-health.share.json").readText()).jsonObject

  @Test fun theProviderServesExactlyTheHealthShare() {
    assertEquals(share.getValue("path").jsonPrimitive.content, HaloHealth.PATH)
    assertEquals(share.getValue("columns").jsonArray.map { it.jsonPrimitive.content }, HaloHealth.COLUMNS.toList())
    assertTrue(HaloHealth.MAX_ROWS <= share.getValue("maxRows").jsonPrimitive.int)
  }

  @Test fun theRowSaysOnOffAndNoAi() {
    assertArrayEquals(arrayOf<Any?>("halo", 1, 0, "none", 5L), HaloHealth.row(accessibility = true, listener = false, lastSeenAt = 5L))
    assertArrayEquals(arrayOf<Any?>("halo", 0, 1, "none", null), HaloHealth.row(accessibility = false, listener = true, lastSeenAt = null))
    assertEquals(HaloHealth.COLUMNS.size, HaloHealth.row(true, true, null).size)
  }

  @Test fun aQueryNeverWritesTheHeartbeat() {
    val provider = File("src/main/java/expo/modules/haloengine/android/HaloLinkProvider.kt").readText()
    val query = provider.substringAfter("override fun query(").substringBefore("override fun insert(")
    assertTrue(query.contains("Heartbeat.lastSeenAt("))
    assertTrue(!query.contains("Heartbeat.beat(") && !query.contains(".edit()"))
    assertTrue("allowed() comes first", query.indexOf("AppLinkCaller.allowed") in 0 until query.indexOf("HaloHealth.row"))
  }
}
