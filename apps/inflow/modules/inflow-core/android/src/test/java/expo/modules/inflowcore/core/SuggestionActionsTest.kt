package expo.modules.inflowcore.core

import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Test

class SuggestionActionsTest {
  private val zone = ZoneId.of("Asia/Karachi")
  private val now = ZonedDateTime.of(2026, 11, 19, 10, 0, 0, 0, zone).toInstant().toEpochMilli()
  private val settings = AutopilotSettings()

  private fun at(day: Int, h: Int, m: Int = 0) = ZonedDateTime.of(2026, 11, day, h, m, 0, 0, zone).toInstant().toEpochMilli()

  private fun s(kind: SuggestionKind, state: SuggestionState = SuggestionState.WAITING, dueAt: Long? = null, expiresAt: Long = now + 3_600_000) =
    Suggestion(1, kind, "t", 1, dueAt, "k", state, now - 1000, now - 1000, expiresAt)

  private fun plan(x: Suggestion, installed: Boolean = true, cfg: AutopilotSettings = settings) = SuggestionActions.plan(x, now, zone, installed, cfg)

  @Test fun everyFinishedStateRefuses() {
    for (st in listOf(SuggestionState.STARTED, SuggestionState.DONE, SuggestionState.SKIPPED, SuggestionState.EXPIRED)) {
      assertEquals(RunPlan.Refuse("That suggestion already ran or expired."), plan(s(SuggestionKind.REPLY, st)))
    }
  }

  @Test fun aWaitingRowThatExpiredBeforeTheTapRefuses() {
    assertEquals(RunPlan.Refuse("That suggestion already ran or expired."), plan(s(SuggestionKind.REPLY, expiresAt = now)))
    assertEquals(RunPlan.Refuse("That suggestion already ran or expired."), plan(s(SuggestionKind.EVENT, dueAt = at(19, 9), expiresAt = at(19, 9))))
  }

  @Test fun anEventOpensTheCalendarAtItsTimeWithAPlainTitle() {
    val due = at(20, 11)
    assertEquals(RunPlan.OpenCalendar("Meeting", due, false), plan(s(SuggestionKind.EVENT, dueAt = due, expiresAt = due)))
    assertEquals(RunPlan.OpenCalendar("Meeting", due, true), plan(s(SuggestionKind.EVENT, dueAt = due, expiresAt = due), cfg = AutopilotSettings(alarmBefore = true)))
  }

  @Test fun anEventWithoutATimeRefuses() {
    assertEquals(RunPlan.Refuse("That meeting has no time to put in the calendar."), plan(s(SuggestionKind.EVENT)))
  }

  @Test fun aBillRemindsAtEightOnTheDueDay() {
    assertEquals(RunPlan.Remind(at(22, 8)), plan(s(SuggestionKind.BILL, dueAt = at(22, 15))))
  }

  @Test fun aBillDueTodayAfterEightRemindsInAMinute() {
    assertEquals(RunPlan.Remind(now + 60_000), plan(s(SuggestionKind.BILL, dueAt = at(19, 9))))
  }

  @Test fun aBillAlreadyOverRemindsInAMinute() {
    assertEquals(RunPlan.Remind(now + 60_000), plan(s(SuggestionKind.BILL, dueAt = at(17, 9))))
  }

  @Test fun aReplyAsksDeputyOrSaysItIsMissing() {
    assertEquals(RunPlan.AskDeputy, plan(s(SuggestionKind.REPLY)))
    assertEquals(RunPlan.Refuse("Deputy isn't installed."), plan(s(SuggestionKind.REPLY), installed = false))
  }

  @Test fun moneyOpensTheBankAppOrInflow() {
    assertEquals(RunPlan.OpenApp(null), plan(s(SuggestionKind.MONEY)))
    assertEquals(RunPlan.OpenApp("com.bank"), plan(s(SuggestionKind.MONEY), cfg = AutopilotSettings(bankApp = "com.bank")))
  }

  @Test fun moneyAndBillsDoNotNeedDeputy() {
    assertEquals(RunPlan.OpenApp(null), plan(s(SuggestionKind.MONEY), installed = false))
    assertEquals(RunPlan.Remind(at(22, 8)), plan(s(SuggestionKind.BILL, dueAt = at(22, 15)), installed = false))
  }

  @Test fun onlyAStoredSuggestionIsAnnounced() {
    val seen = mutableListOf<Suggestion>()
    val store = NotifyingSuggestionStore(MemorySuggestionStore()) { seen += it }
    val x = s(SuggestionKind.REPLY).copy(id = 0)
    val id = store.add(x)!!
    assertEquals(null, store.add(x))
    assertEquals(listOf(x.copy(id = id)), seen)
  }
}
