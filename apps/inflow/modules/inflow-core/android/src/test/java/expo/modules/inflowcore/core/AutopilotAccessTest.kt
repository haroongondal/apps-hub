package expo.modules.inflowcore.core

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AutopilotAccessTest {
  // Gradle runs module unit tests from the module's android/ folder: five levels up is the repo root.
  private val fixture = File("../../../../../packages/autopilot-contract/fixtures/never-share.json")

  private fun fixturePackages(): Set<String> {
    assertTrue("fixture not found from ${File(".").absoluteFile}", fixture.isFile)
    return Json.parseToJsonElement(fixture.readText()).jsonArray.map { it.jsonPrimitive.content }.toSet()
  }

  @Test fun theConstantsEqualTheSharedFixture() = assertEquals(fixturePackages(), AutopilotAccess.NEVER_SHARE)

  @Test fun neverSharePackagesNeverCross() {
    for (pkg in fixturePackages()) {
      assertFalse(AutopilotAccess.mayShare(pkg, true))
      assertFalse(AutopilotAccess.mayShare(pkg, false))
    }
  }

  @Test fun anyOtherPackageFollowsTheQueueFilter() {
    assertTrue(AutopilotAccess.mayShare("com.whatsapp", true))
    assertFalse(AutopilotAccess.mayShare("com.whatsapp", false))
  }

  // The same five refusals as the SQL (proved on a seeded sqlite3 database, since SQLCipher cannot run on the JVM), here on the in-memory twin.
  private val store = MemoryItemStore()
  private val wa = "com.whatsapp"
  private val sms = "com.google.android.apps.messaging"

  private val now = 2_000_000L

  /** A suggestion for the item, so the item's own filter is what the test exercises. */
  private fun suggest(id: Long, kind: SuggestionKind = SuggestionKind.REPLY, state: SuggestionState = SuggestionState.WAITING, expiresAt: Long = now + 1_000) =
    store.suggestions.add(Suggestion(0, kind, "Reply to Ammi", id, null, "k$id${kind.name}${state.name}", state, 0, 0, expiresAt))

  private fun item(id: Long) = store.autopilotItem(id, now)

  private fun add(pkg: String, key: String?, text: String, otp: Long? = null, smsHash: String? = null, sender: String? = "Ammi", reply: Boolean = true): Long {
    val c = Capture(pkg, "App", sender, "sk:$text", "Chat", key, "t", text, 1_000, "h$text", false)
    return store.insert(c, text, otp, smsHash)!!.also { if (reply) suggest(it) }
  }

  @Test fun refusesTheFiveCasesAndReturnsAPickedChat() {
    store.setMeta(AUTOPILOT_META, AutopilotSettings(pickedChats = setOf("$wa|wa:ammi", "com.haroon.strongroom|wa:ammi", "com.haroon.inflow|wa:ammi")).toJson())
    store.putAppSetting(AppSetting("com.off", "Off", false, null))
    store.aiBlocks += "app:com.blocked"
    val otp = add(sms, "num:1", "otp 123456", otp = 9_000, smsHash = "a")
    val blocked = add("com.blocked", "wa:ammi", "from a blocked app")
    val off = add("com.off", "wa:ammi", "recording off")
    val strongroom = add("com.haroon.strongroom", "wa:ammi", "vault")
    val inflow = add("com.haroon.inflow", "wa:ammi", "own")
    val unpicked = add(wa, "wa:other", "not picked")
    val picked = add(wa, "wa:ammi", "salaam")
    for (id in listOf(otp, blocked, off, strongroom, inflow, unpicked, 999L)) assertNull("item $id", item(id))
    assertEquals(AutopilotItem(picked, "App", wa, "Ammi", "Chat", "salaam", 1_000), item(picked))
  }

  @Test fun anSmsAndAnEmailCrossWithoutBeingPicked() {
    val s = add(sms, "num:2", "bill text", smsHash = "b")
    assertEquals("bill text", item(s)?.text)
    store.insert(Capture("com.google.android.gm", "Gmail", "Bob", "e:bob", null, null, "Hi", "subject", 2_000, "he", false), "x", null, null, "eh")
    store.claimEmail(2, "eh", "the full email", "x")
    suggest(2)
    assertEquals("the full email", item(2)?.text)
  }

  @Test fun aBlockedSenderIsRefused() {
    store.aiBlocks += "sender:sk:vip"
    val id = store.insert(Capture(sms, "App", "VIP", "sk:vip", null, "num:3", "t", "hello", 1, "hv", false), "x", null, "c")!!.also { suggest(it) }
    assertNull(item(id))
  }

  @Test fun aPickedNumberChatDoesNotOpenTheSameNumberInAnotherApp() {
    store.setMeta(AUTOPILOT_META, AutopilotSettings(pickedChats = setOf("$wa|num:3001234567")).toJson())
    val signal = add("org.thoughtcrime.securesms", "num:3001234567", "from signal")
    val whatsapp = add(wa, "num:3001234567", "from whatsapp")
    assertNull(item(signal))
    assertEquals("from whatsapp", item(whatsapp)?.text)
  }

  @Test fun anItemWithoutALiveReplySuggestionIsRefused() {
    val none = add(sms, "num:5", "no suggestion", smsHash = "n", reply = false)
    val waiting = add(sms, "num:6", "waiting", smsHash = "w", reply = false).also { suggest(it) }
    val started = add(sms, "num:7", "started", smsHash = "s", reply = false).also { suggest(it, state = SuggestionState.STARTED) }
    val expired = add(sms, "num:8", "expired", smsHash = "e", reply = false).also { suggest(it, expiresAt = now - 1) }
    val done = add(sms, "num:9", "done", smsHash = "d", reply = false).also { suggest(it, state = SuggestionState.DONE) }
    val bill = add(sms, "num:10", "bill", smsHash = "b2", reply = false).also { suggest(it, kind = SuggestionKind.BILL) }
    assertNull(item(none)); assertNull(item(expired)); assertNull(item(done)); assertNull(item(bill))
    assertEquals("waiting", item(waiting)?.text)
    assertEquals("started", item(started)?.text)
  }
}
