package expo.modules.deputyagent.core

import kotlinx.coroutines.async
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GateNonceTest {
  @Test fun idsAre128BitRandomHex() {
    val gates = Gates(now = { 0L })
    val a = gates.open("r1", GateKind.CONFIRM, "Chat", "Tap", "Send").id
    gates.resolve(a, approve = false, text = null)
    val b = gates.open("r1", GateKind.CONFIRM, "Chat", "Tap", "Send").id
    assertTrue(a, a.matches(Regex("[0-9a-f]{32}")))
    assertNotEquals(a, b)
  }

  @Test fun anApprovalIsAcceptedOnceAndReachesTheWaitingRun() = runTest {
    val gates = Gates(now = { testScheduler.currentTime })
    val gate = gates.open("r1", GateKind.CONFIRM, "Chat", "Tap", "Send")
    val answer = async { gates.await(gate) }
    runCurrent()
    assertTrue(gates.resolve(gate.id, approve = true, text = null))
    assertFalse("replay must be dropped", gates.resolve(gate.id, approve = false, text = null))
    assertEquals(Answer(approved = true, text = null), answer.await())
  }

  @Test fun anAnswerAtTheDeadlineIsDroppedEvenWithNoRunWaiting() {
    var now = 0L
    val gates = Gates { now }
    val gate = gates.open("r1", GateKind.CONFIRM, "Chat", "Tap", "Send")
    now = gate.expiresAt
    assertFalse(gates.resolve(gate.id, approve = true, text = null))
  }

  @Test fun aLongDraftIsCutWithAMark() {
    val gate = Gates { 0L }.open("r1", GateKind.CONFIRM, "Chat", "Tap", "Send", draftText = "a".repeat(250))
    assertEquals(200, gate.draftText!!.length)
    assertTrue(gate.draftText!!.endsWith("…"))
  }

  @Test fun unknownIdsAreDropped() {
    val gates = Gates(now = { 0L })
    gates.open("r1", GateKind.CONFIRM, "Chat", "Tap", "Send")
    assertFalse(gates.resolve("0".repeat(32), approve = true, text = null))
  }

  @Test fun noAnswerByTheDeadlineCountsAsNoAndLateAnswersAreDropped() = runTest {
    val gates = Gates(now = { testScheduler.currentTime })
    val gate = gates.open("r1", GateKind.CONFIRM, "Chat", "Tap", "Send")
    assertEquals(5 * 60_000L, gate.expiresAt)
    val answer = async { gates.await(gate) }
    advanceTimeBy(5 * 60_000L + 1)
    assertNull(answer.await())
    assertFalse(gates.resolve(gate.id, approve = true, text = null))
  }

  @Test fun aGateFromAnEndedRunCannotAnswerTheNextRun() = runTest {
    val gates = Gates(now = { testScheduler.currentTime })
    val old = gates.open("r1", GateKind.CONFIRM, "Chat", "Tap", "Send")
    val first = async { gates.await(old) }
    runCurrent()
    first.cancel()
    runCurrent()
    assertNull(gates.pending())
    assertFalse(gates.resolve(old.id, approve = true, text = null))
    val next = gates.open("r2", GateKind.CONFIRM, "Chat", "Tap", "Send")
    assertFalse(gates.resolve(old.id, approve = true, text = null))
    assertEquals(next, gates.pending())
  }

  @Test fun aQuestionCarriesTheOwnersTextButIsNotAnApproval() = runTest {
    val gates = Gates(now = { testScheduler.currentTime })
    val gate = gates.open("r1", GateKind.QUESTION, "Chat", "Which Ali?", options = listOf("Ali K", "Ali R"))
    val answer = async { gates.await(gate) }
    runCurrent()
    assertTrue(gates.resolve(gate.id, approve = true, text = "Ali K"))
    assertEquals(Answer(approved = false, text = "Ali K"), answer.await())
  }
}
