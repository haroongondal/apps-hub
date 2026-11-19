package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DotKindsTest {
  private val all = DotKind.entries.toSet()

  @Test fun classifyBrandFirstThenCategoryThenKnownPackages() {
    assertEquals(DotKind.WHATSAPP, DotKinds.classify("com.whatsapp", "msg"))
    assertEquals(DotKind.WHATSAPP, DotKinds.classify("com.whatsapp.w4b", "call"))
    assertEquals(DotKind.INSTAGRAM, DotKinds.classify("com.instagram.android", null))
    assertEquals(DotKind.CALL, DotKinds.classify("com.any", "missed_call"))
    assertEquals(DotKind.CALL, DotKinds.classify("com.any", "call"))
    assertEquals(DotKind.CALL, DotKinds.classify("com.google.android.dialer", null))
    assertEquals(DotKind.MESSAGE, DotKinds.classify("org.telegram.messenger", "msg"))
    assertEquals(DotKind.MESSAGE, DotKinds.classify("com.google.android.apps.messaging", null))
    assertEquals(DotKind.EMAIL, DotKinds.classify("com.any", "email"))
    assertEquals(DotKind.EMAIL, DotKinds.classify("com.google.android.gm", null))
    assertEquals(DotKind.OTHER, DotKinds.classify("com.any", "social"))
    assertEquals(DotKind.OTHER, DotKinds.classify("com.any", null))
  }

  @Test fun everyKindHasItsOwnColourShapeAndKey() {
    assertEquals(DotKind.entries.size, DotKind.entries.map { it.colour }.toSet().size)
    assertEquals(DotKind.entries.size, DotKind.entries.map { it.shape }.toSet().size)
    assertEquals(DotKind.entries.size, DotKind.entries.map { it.key }.toSet().size)
    assertTrue(DotKind.entries.all { it.colour ushr 24 == 0xFF })
  }

  @Test fun brandColourOnlyForBrands() {
    assertEquals(0xFF25D366.toInt(), DotKinds.brandColour("com.whatsapp"))
    assertEquals(0xFFFF3D9A.toInt(), DotKinds.brandColour("com.instagram.android"))
    assertNull(DotKinds.brandColour("com.google.android.dialer"))
    assertNull(DotKinds.brandColour("com.any"))
  }

  @Test fun mergesGroupsOfOneKindAndAddsSystemStatesInDisplayOrder() {
    val notes = listOf(
      NoteGroup("com.any", null, 2),
      NoteGroup("com.whatsapp", "msg", 3),
      NoteGroup("org.other", "social", 1),
      NoteGroup("com.whatsapp", null, 1),
      NoteGroup("com.any", "missed_call", 1),
    )
    val row = DotKinds.dots(notes, DotSystemState(charging = true, alarmSoon = true, mediaPlaying = true), all)
    assertEquals(
      listOf(Dot(DotKind.CHARGING, 1), Dot(DotKind.CALL, 1), Dot(DotKind.WHATSAPP, 4), Dot(DotKind.OTHER, 3), Dot(DotKind.ALARM, 1), Dot(DotKind.MEDIA, 1)),
      row.dots,
    )
    assertEquals(0, row.overflow)
  }

  @Test fun lowBatteryShowsOnlyWhenNotCharging() {
    assertEquals(listOf(Dot(DotKind.LOW_BATTERY, 1)), DotKinds.dots(emptyList(), DotSystemState(lowBattery = true), all).dots)
    assertEquals(listOf(Dot(DotKind.CHARGING, 1)), DotKinds.dots(emptyList(), DotSystemState(charging = true, lowBattery = true), all).dots)
  }

  @Test fun disabledKindsAreDroppedBeforeTheCap() {
    val notes = listOf(NoteGroup("com.whatsapp", null, 1), NoteGroup("com.any", null, 1))
    val row = DotKinds.dots(notes, DotSystemState(charging = true), all - DotKind.WHATSAPP - DotKind.CHARGING, max = 1)
    assertEquals(DotRow(listOf(Dot(DotKind.OTHER, 1)), 0), row)
    assertEquals(DotRow(emptyList(), 0), DotKinds.dots(notes, DotSystemState(charging = true), emptySet()))
  }

  @Test fun capKeepsTheFirstInOrderAndCountsTheRest() {
    val notes = listOf(
      NoteGroup("com.whatsapp", null, 1), NoteGroup("com.instagram.android", null, 1), NoteGroup("com.any", "msg", 1),
      NoteGroup("com.any", "email", 1), NoteGroup("com.any", null, 1), NoteGroup("com.any", "call", 1),
    )
    val sys = DotSystemState(charging = true, alarmSoon = true, mediaPlaying = true)
    val full = DotKinds.dots(notes, sys, all, max = 20)
    assertEquals(9, full.dots.size)
    val row = DotKinds.dots(notes, sys, all, max = 3)
    assertEquals(listOf(DotKind.CHARGING, DotKind.CALL, DotKind.WHATSAPP), row.dots.map { it.kind })
    assertEquals(6, row.overflow)
    assertEquals(DotRow(emptyList(), 9), DotKinds.dots(notes, sys, all, max = 0))
    assertEquals(DotRow(emptyList(), 0), DotKinds.dots(emptyList(), DotSystemState(), all))
  }
}
