package expo.modules.inflowcore.core

import expo.modules.aihubclient.core.Kinds
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Health text goes to AI hub only from Ask with its switch on. Every request the hub gets is recorded, and the health canaries are everywhere in the stores.
class AskRunTest {
  private val zone = ZoneId.of("Asia/Karachi")
  private fun at(s: String) = LocalDateTime.parse(s).atZone(zone).toInstant().toEpochMilli()
  private val now = at("2026-11-14T10:30")

  private val health = MemoryHealthStore().apply { rows["2026-11-10"] = HealthDay("2026-11-10", 48_213, 401, 71, 57) }
  private val meds = MemoryMedicineStore().apply {
    insert(Medicine(0, "CANARY-MEDICINE", "CANARY-DOSE", listOf(LocalTime.of(8, 0)), DayOfWeek.values().toSet(), LocalDate.parse("2026-11-01"), null, createdAt = at("2026-10-30T00:00")))
  }

  private val requests = mutableListOf<String>()
  private var hub: (Int) -> String = { n -> if (n == 1) FakeHub.reply("""{"from":"2026-11-01","to":"2026-11-14","apps":["sms.app","made.up"],"money":false}""") else FakeHub.reply(" You slept well. ") }
  private var cap = false
  private var foundPkgs: List<String>? = null

  private fun run(healthSwitchOn: Boolean, question: String = "How did I sleep?") = AskRun(
    FakeHub.ai(foreground = true) { requests += it; hub(requests.size) },
    {}, { cap }, { listOf("sms.app" to "Messages") },
    { _, pkgs -> foundPkgs = pkgs; listOf(AskItem("Messages", "Bank", at("2026-11-10T12:00"), null, "You paid 500")) },
    { emptyList() },
    { from, to -> HealthForAsk.context(healthSwitchOn, health, meds, from, to, now, zone) },
    { now }, zone,
  ).run(question)

  @Test fun withTheSwitchOffNoRequestCarriesHealth() {
    val r = run(false)
    assertEquals("You slept well.", r.answer)
    assertEquals(2, requests.size)
    for (req in requests) for (canary in listOf("48213", "401 min", "CANARY", "steps", "Health from", "never diagnose")) assertFalse("$canary in $req", req.contains(canary))
  }

  @Test fun withTheSwitchOnOnlyTheAnswerRequestCarriesTheDailyNumbers() {
    assertEquals("You slept well.", run(true).answer)
    assertEquals(2, requests.size)
    assertFalse(requests[0].contains("48213"))   // the plan never sees health
    assertTrue(requests[1].contains("2026-11-10: steps 48213, sleep 401 min"))
    assertTrue(requests[1].contains("never diagnose"))
    for (canary in listOf("CANARY-MEDICINE", "CANARY-DOSE")) for (req in requests) assertFalse(canary, req.contains(canary))
  }

  @Test fun aPackageThePlanMadeUpIsDropped() {
    run(false)
    assertEquals(listOf("sms.app"), foundPkgs)
  }

  @Test fun theDailyLimitSendsNothing() {
    cap = true
    val r = run(true)
    assertEquals(AiRun.CAP_REACHED, r.error)
    assertNull(r.answer)
    assertTrue(requests.isEmpty())
  }

  @Test fun aHubThatIsNotReadyAnswersInPlainWordsAndSendsNoHealth() {
    for ((kind, copy) in listOf(Kinds.HUB_MISSING to HubCopy.MISSING, Kinds.NOT_ALLOWED to HubCopy.NOT_ALLOWED, Kinds.NO_KEY to HubCopy.NO_KEY, Kinds.TIMEOUT to "The AI took too long to answer. Try again.")) {
      requests.clear()
      hub = { FakeHub.fail(kind) }
      val r = run(true)
      assertEquals(kind, copy, r.error)
      assertNull(r.answer)
      assertEquals(kind, 1, requests.size)   // stops at the plan: the answer request, which would carry health, is never built
      assertFalse(requests.single().contains("48213"))
    }
  }
}
