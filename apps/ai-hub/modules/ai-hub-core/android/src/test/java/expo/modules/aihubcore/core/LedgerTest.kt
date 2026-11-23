package expo.modules.aihubcore.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LedgerTest {
  @Test fun pendingKeepsOneRowPerAppNewestFirst() {
    val a = PendingApps.record(emptyList(), "a", 1_000)!!
    val ab = PendingApps.record(a, "b", 2_000)!!
    assertEquals(listOf(PendingApp("b", 2_000), PendingApp("a", 1_000)), ab)
    val again = PendingApps.record(ab, "a", 2_000 + PendingApps.QUIET_MS)!!
    assertEquals(listOf(PendingApp("a", 2_000 + PendingApps.QUIET_MS), PendingApp("b", 2_000)), again)
  }

  @Test fun pendingSkipsTheWriteWhenTheAppAskedMomentsAgo() {
    val a = PendingApps.record(emptyList(), "a", 1_000)!!
    assertNull(PendingApps.record(a, "a", 1_000 + PendingApps.QUIET_MS - 1))
  }

  @Test fun pendingIsCapped() {
    var list = emptyList<PendingApp>()
    repeat(PendingApps.CAP + 5) { list = PendingApps.record(list, "app$it", it.toLong())!! }
    assertEquals(PendingApps.CAP, list.size)
    assertEquals("app${PendingApps.CAP + 4}", list.first().pkg)
  }

  @Test fun pendingRoundTripsAndDropsAnAppOnceDecided() {
    val list = listOf(PendingApp("b", 2), PendingApp("a", 1))
    assertEquals(list, PendingApps.parse(PendingApps.toJson(list)))
    assertEquals(listOf(PendingApp("a", 1)), PendingApps.remove(list, "b"))
    assertEquals(emptyList<PendingApp>(), PendingApps.parse("{broken"))
    assertEquals(listOf(PendingApp("a", 0)), PendingApps.parse("""{"apps":[{"pkg":"a"},{"pkg":""},{"lastMs":3},5]}"""))
  }

  @Test fun callLogIsNewestFirstAndCappedAt200() {
    var log = emptyList<LoggedCall>()
    repeat(CallLog.CAP + 10) { log = CallLog.add(log, LoggedCall("app", "chat", "groq", it.toLong())) }
    assertEquals(200, log.size)
    assertEquals(CallLog.CAP + 9L, log.first().timeMs)
    assertEquals(10L, log.last().timeMs)
  }

  @Test fun callLogStoresOnlyAppJobServiceAndTime() {
    val log = listOf(LoggedCall("com.haroon.nexus", "embed", "gemini", 5))
    val text = CallLog.toJson(log)
    val row = Json.parseToJsonElement(text).jsonObject["calls"]!!.jsonArray.single().jsonObject
    assertEquals(setOf("pkg", "job", "service", "timeMs"), row.keys)
    assertEquals(log, CallLog.parse(text))
    assertEquals(emptyList<LoggedCall>(), CallLog.parse(null))
    assertEquals(emptyList<LoggedCall>(), CallLog.parse("""{"calls":[{"pkg":"a","job":"chat"}]}"""))
  }
}
