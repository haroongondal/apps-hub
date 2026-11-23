package expo.modules.inflowcore.core

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChangedPingTest {
  private val ping = ChangedPing()
  private val w = ChangedPing.WINDOW_MS

  @Test fun theFirstChangePingsAtOnce() = assertEquals(PingDecision.SendNow, ping.request(5_000))

  @Test fun aBurstInsideTheWindowAsksForExactlyOneTrailingPingAtTheEndOfTheWindow() {
    assertEquals(PingDecision.SendNow, ping.request(0))
    assertEquals(PingDecision.SendAt(w), ping.request(10))
    for (t in listOf(11L, 500L, 20_000L, w - 1)) assertEquals("at $t", PingDecision.None, ping.request(t))
  }

  @Test fun aChangeAfterTheTrailingPingStartsTheNextWindowFromIt() {
    ping.request(0)
    ping.request(10)   // trailing planned at w
    assertEquals(PingDecision.SendAt(2 * w), ping.request(w + 5))   // not lost, and still 60 s after the last ping
    assertEquals(PingDecision.None, ping.request(w + 6))
  }

  @Test fun aSteadyTrickleIsOnePingEverySixtySeconds() {
    val sent = mutableListOf<Long>()
    var t = 0L
    repeat(40) {
      when (val d = ping.request(t)) {
        PingDecision.SendNow -> sent += t
        is PingDecision.SendAt -> sent += d.at
        PingDecision.None -> {}
      }
      t += 20_000   // a change every 20 s for ~13 minutes
    }
    assertTrue(sent.toString(), sent.zipWithNext().all { (a, b) -> b - a >= w })
    assertTrue(sent.size >= 12)
  }

  @Test fun changesSpacedBeyondTheWindowAllPingAtOnce() {
    assertEquals(PingDecision.SendNow, ping.request(0))
    assertEquals(PingDecision.SendNow, ping.request(w))
    assertEquals(PingDecision.SendNow, ping.request(3 * w))
  }

  @Test fun aClockThatWentBackDoesNotSilenceThePing() {
    ping.request(1_000_000)
    ping.request(1_000_010)   // plans 1_000_000 + w
    assertEquals(PingDecision.SendNow, ping.request(10))
  }

  // ---- the broadcast

  private class Transport(val trust: Boolean) : PingTransport {
    val sent = mutableListOf<Pair<String, String>>()
    var asked = 0
    override fun trusted(action: String, pkg: String): Boolean { asked++; return trust }
    override fun send(action: String, pkg: String) { sent += action to pkg }
  }

  @Test fun anUntrustedHaloGetsNothingAndThereIsNoFallback() {
    val t = Transport(false)
    assertFalse(ChangedSender.send(t))
    assertEquals(1, t.asked)
    assertTrue(t.sent.isEmpty())
  }

  @Test fun aTrustedHaloGetsOneBroadcastForTheContractActionToHaloOnly() {
    val t = Transport(true)
    assertTrue(ChangedSender.send(t))
    assertEquals(listOf("com.haroon.autopilot.CHANGED" to "com.haroon.halo"), t.sent)
  }

  @Test fun theActionAndThePackageAreTheContractsOwn() {
    val links = File("../../../../../packages/app-link-contract/src/links.ts").also { assertTrue("not found from ${File(".").absoluteFile}", it.isFile) }.readText()
    val block = Regex("export const CHANGED_PING = Object\\.freeze\\(\\{([^}]*)\\}\\)").find(links)!!.groupValues[1]
    assertEquals(ChangedSender.ACTION, Regex("action: '([^']+)'").find(block)!!.groupValues[1])
    assertEquals(ChangedSender.TARGET, Regex("targetPackage: '([^']+)'").find(block)!!.groupValues[1])
  }

  // ---- the waiting set

  @Test fun theSameWaitingSetDoesNotPingAndAnyOtherDoes() {
    var pings = 0
    val watch = WaitingWatch { pings++ }
    watch.after(listOf(1, 2))
    assertEquals(1, pings)   // the first look counts
    watch.after(listOf(2, 1))
    watch.after(listOf(1, 2))
    assertEquals(1, pings)
    watch.after(listOf(1, 2, 3))   // a new one
    assertEquals(2, pings)
    watch.after(listOf(1, 3))   // one left the waiting state
    assertEquals(3, pings)
    watch.after(emptyList())
    assertEquals(4, pings)
    watch.after(emptyList())
    assertEquals(4, pings)
  }

  @Test fun aFailingReceiverDoesNotBreakTheWatch() {
    val watch = WaitingWatch { throw IllegalStateException("x") }
    watch.after(listOf(1))
    watch.after(listOf(1, 2))
  }
}
