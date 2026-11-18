package expo.modules.inflowcore.core

import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 2025 is used for the weekly cases because 16 Nov 2025 is a Sunday and 1 Dec 2025 a Monday. */
class ReportScheduleTest {
  private val karachi = ZoneId.of("Asia/Karachi")   // UTC+5, no daylight saving

  private fun at(local: String) = Instant.parse("${local}Z").toEpochMilli() - 5 * 3_600_000L   // local Karachi time written as ISO

  @Test fun sundayAfterNineIsTheWeekThatJustEnded() {
    val p = ReportSchedule.lastWeek(at("2025-11-16T21:30:00"), karachi)
    assertEquals(Period(ReportKind.WEEKLY, at("2025-11-09T21:00:00"), at("2025-11-16T21:00:00"), false), p)
    assertEquals("Week of 10–16 Nov", ReportSchedule.label(p, karachi))
  }

  @Test fun beforeNineOnSundayItIsTheWeekBefore() {
    val p = ReportSchedule.lastWeek(at("2025-11-16T20:59:00"), karachi)
    assertEquals(at("2025-11-09T21:00:00"), p.end)
    assertEquals(at("2025-11-02T21:00:00"), p.start)
    assertEquals("Week of 3–9 Nov", ReportSchedule.label(p, karachi))
  }

  @Test fun exactlyNineIsDue() {
    assertEquals(at("2025-11-16T21:00:00"), ReportSchedule.lastWeek(at("2025-11-16T21:00:00"), karachi).end)
  }

  @Test fun midWeekAndAMonthLaterStillGiveTheLastEndedWeek() {
    assertEquals(at("2025-11-16T21:00:00"), ReportSchedule.lastWeek(at("2025-11-19T12:00:00"), karachi).end)
    assertEquals(at("2025-12-14T21:00:00"), ReportSchedule.lastWeek(at("2025-12-17T08:00:00"), karachi).end)
  }

  @Test fun weekAcrossMonthsIsLabelledWithBothMonths() {
    val p = ReportSchedule.lastWeek(at("2025-11-02T21:30:00"), karachi)
    assertEquals("Week of 27 Oct–2 Nov", ReportSchedule.label(p, karachi))
  }

  @Test fun lastMonthIsTheCalendarMonthBefore() {
    val p = ReportSchedule.lastMonth(at("2025-12-01T00:10:00"), karachi)
    assertEquals(Period(ReportKind.MONTHLY, at("2025-11-01T00:00:00"), at("2025-12-01T00:00:00"), false), p)
    assertEquals("November 2025", ReportSchedule.label(p, karachi))
    val dec = ReportSchedule.lastMonth(at("2026-01-15T10:00:00"), karachi)
    assertEquals("December 2025", ReportSchedule.label(dec, karachi))
    assertEquals("November 2026", ReportSchedule.label(ReportSchedule.lastMonth(at("2026-12-01T00:10:00"), karachi), karachi))
  }

  @Test fun monthEndsJustBeforeTheFirst() {
    // 23:59 on 30 Nov is still November: the previous month is October.
    assertEquals(at("2025-11-01T00:00:00"), ReportSchedule.lastMonth(at("2025-11-30T23:59:00"), karachi).end)
  }

  @Test fun weekSoFarStartsAtTheLastSundayNineAndIsPartial() {
    val now = at("2025-11-19T12:00:00")   // a Wednesday
    val p = ReportSchedule.weekSoFar(now, karachi)
    assertEquals(Period(ReportKind.WEEKLY, at("2025-11-16T21:00:00"), now, true), p)
    assertTrue(p.partial)
    assertEquals("Week of 17–23 Nov", ReportSchedule.label(p, karachi))
    assertFalse(ReportSchedule.lastWeek(now, karachi).partial)
  }

  @Test fun otherTimeZoneUsesItsOwnLocalSunday() {
    val la = ZoneId.of("America/Los_Angeles")
    // 2025-11-17T05:30Z is Sunday 16 Nov 21:30 in Los Angeles (UTC-8), already Monday in Karachi.
    val p = ReportSchedule.lastWeek(Instant.parse("2025-11-17T05:30:00Z").toEpochMilli(), la)
    assertEquals(Instant.parse("2025-11-17T05:00:00Z").toEpochMilli(), p.end)
  }
}
