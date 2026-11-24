package expo.modules.inflowcore.core

import expo.modules.aihubclient.core.Kinds
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AiSwitchTest {
  private class Keys(var saved: Int) : OwnKeys {
    var deletes = 0
    override fun any() = saved > 0
    override fun deleteAll() {
      deletes++
      saved = 0
    }
  }

  private val store = MemoryItemStore()
  private var clock = 1_000L

  private fun switch(keys: Keys) = AiSwitch(store, keys, { clock })

  // The hub call the way AiConfig wires it: the cleanup runs only from a reply Inflow could read.
  private fun hubCall(sw: AiSwitch, hub: () -> String) = runCatching { FakeHub.ai(answered = sw::hubAnswered) { hub() }.complete("s", "u") }

  @Test fun availableOkWithoutASuccessfulCallKeepsTheKeys() {
    val keys = Keys(2)
    val sw = switch(keys)
    sw.on()      // what the screens and the status read
    sw.cleanup() // every start
    assertEquals(0, keys.deletes)
    assertTrue(keys.any())
    assertNull(store.meta(AiMeta.HUB_WORKED))
  }

  @Test fun aFailedHubCallKeepsTheKeys() {
    for (kind in listOf(Kinds.NOT_ALLOWED, Kinds.NO_KEY, Kinds.BUSY, Kinds.HUB_MISSING, Kinds.VERSION, Kinds.TIMEOUT, Kinds.PROVIDER)) {
      val keys = Keys(1)
      val sw = switch(keys)
      assertTrue(kind, hubCall(sw) { FakeHub.fail(kind) }.isFailure)
      sw.cleanup()
      assertEquals(kind, 0, keys.deletes)
      assertNull(kind, store.meta(AiMeta.HUB_WORKED))
    }
  }

  @Test fun anEmptyOrUnreadableReplyKeepsTheKeys() {
    val keys = Keys(1)
    val sw = switch(keys)
    assertTrue(hubCall(sw) { """{"text":"no model"}""" }.isFailure)
    assertTrue(hubCall(sw) { "not json" }.isFailure)
    assertEquals(0, keys.deletes)
  }

  @Test fun theFirstSuccessfulCallDeletesTheKeysAndAiStaysOn() {
    val keys = Keys(2)
    val sw = switch(keys)
    assertEquals("from hub", hubCall(sw) { FakeHub.reply("from hub") }.getOrThrow().text)
    assertEquals(1, keys.deletes)
    assertFalse(keys.any())
    assertEquals("1", store.meta(AiMeta.HUB_WORKED))
    assertTrue(sw.on())   // the phone had a key, so AI was on and stays on without it
    assertTrue(switch(keys).on())
  }

  @Test fun theCleanupSurvivesARestartWhileTheMarkerExists() {
    val keys = Keys(1)
    store.setMeta(AiMeta.HUB_WORKED, "1")   // a success earlier, whose delete did not finish
    switch(keys).cleanup()
    assertEquals(1, keys.deletes)
    assertFalse(keys.any())
  }

  @Test fun aFailingDeleteNeverLosesTheReplyAndIsRetriedAtTheNextStart() {
    var fail = true
    val keys = object : OwnKeys {
      var saved = true
      override fun any() = saved
      override fun deleteAll() {
        if (fail) throw IllegalStateException("disk")
        saved = false
      }
    }
    val sw = AiSwitch(store, keys, { clock })
    assertEquals("ok", hubCall(sw) { FakeHub.reply("ok") }.getOrThrow().text)
    assertTrue(keys.saved)
    fail = false
    sw.cleanup()
    assertFalse(keys.saved)
  }

  @Test fun aPhoneWithKeysWasOnAndOneWithoutWasOff() {
    assertTrue(switch(Keys(1)).on())
    val other = MemoryItemStore()
    assertFalse(AiSwitch(other, Keys(0), { clock }).on())
    assertEquals("0", other.meta(AiMeta.ON))
  }

  @Test fun turningItOnSetsSinceOnceAndOffKeepsIt() {
    val sw = switch(Keys(0))
    assertFalse(sw.on())
    sw.set(true)
    assertTrue(sw.on())
    assertEquals("1000", store.meta(AiMeta.SINCE))
    clock = 9_000L
    sw.set(false)
    assertFalse(sw.on())
    sw.set(true)
    assertEquals("1000", store.meta(AiMeta.SINCE))
  }
}
