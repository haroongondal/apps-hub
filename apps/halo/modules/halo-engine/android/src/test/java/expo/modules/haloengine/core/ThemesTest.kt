package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ThemesTest {
  private val a = Theme("a", "A", "big-digits")
  private val b = Theme("b", "B", "stacked")
  private val c = Theme("c", "C", "ring-analog")
  private val all = listOf(a, b, c)
  private fun min(h: Int, m: Int) = h * 60 + m

  @Test
  fun slotsCrossMidnight() {
    val aod = SettingsAod(themeId = "a", slots = listOf(AodSlot("07:00", "b"), AodSlot("22:00", "c")))
    assertEquals("c", Themes.resolve(aod, all, min(23, 59)).id)
    assertEquals("c", Themes.resolve(aod, all, min(0, 1)).id) // the 22:00 slot runs past midnight
    assertEquals("b", Themes.resolve(aod, all, min(7, 0)).id)
    assertEquals("b", Themes.resolve(aod, all, min(21, 59)).id)
    assertEquals("c", Themes.resolve(aod, all, min(22, 0)).id)
  }

  @Test
  fun slotsNeedNoOrder() {
    val aod = SettingsAod(themeId = "a", slots = listOf(AodSlot("22:00", "c"), AodSlot("07:00", "b")))
    assertEquals("b", Themes.resolve(aod, all, min(12, 0)).id)
  }

  @Test
  fun fallbacks() {
    assertEquals("a", Themes.resolve(SettingsAod(themeId = "a"), all, 600).id) // no slots
    assertEquals("b", Themes.resolve(SettingsAod(themeId = "b", slots = listOf(AodSlot("07:00", "gone"))), all, 600).id) // slot theme deleted
    assertEquals("a", Themes.resolve(SettingsAod(themeId = "gone"), all, 600).id) // unknown -> first in the list
    assertEquals("night", Themes.resolve(SettingsAod(themeId = "a"), emptyList(), 600).id) // empty list -> first starter
  }

  @Test
  fun unknownFaceAndMissingPhotoFallBack() {
    val faceIds = Faces.all.map { it().id }.toSet()
    val broken = Theme("x", "X", "deleted-face", photo = true)
    val fixed = Themes.usable(broken, faceIds, photoExists = false)
    assertEquals("big-digits", fixed.face)
    assertFalse(fixed.photo)
    assertEquals("x", fixed.id)
    val fine = Theme("y", "Y", "stacked", photo = true)
    assertEquals(fine, Themes.usable(fine, faceIds, photoExists = true))
    assertTrue(Themes.usable(fine, faceIds, photoExists = true).photo)
    assertFalse(Themes.usable(Theme("z", "Z", "stacked", photo = false), faceIds, photoExists = true).photo)
  }

  @Test
  fun starterThemesValid() {
    // The constant itself, not Themes.starter(): nothing may repair a typo before this check sees it.
    assertTrue(STARTER_THEMES.isNotEmpty())
    assertEquals(STARTER_THEMES.size, STARTER_THEMES.map { it.id }.toSet().size)
    val faceIds = Faces.all.map { it().id }.toSet()
    val patternIds = Patterns.all.map { it().id }.toSet()
    for (t in STARTER_THEMES) {
      assertTrue("face of ${t.id}", t.face in faceIds)
      assertTrue("pattern of ${t.id}", t.edge.pattern in patternIds)
    }
  }

  @Test
  fun previewFilesBelongToTheirOwnThemeOnly() {
    assertTrue(Themes.isPreviewOf("theme-1", "theme-1-1731900000000.png"))
    assertFalse(Themes.isPreviewOf("theme-1", "theme-10-1731900000000.png"))
    assertFalse(Themes.isPreviewOf("theme-1", "theme-19-1.png"))
    assertFalse(Themes.isPreviewOf("theme-1", "theme-1-abc.png"))
    assertFalse(Themes.isPreviewOf("theme-1", "theme-1-5.png.tmp"))
    assertTrue(Themes.isPreviewOf("theme-10", "theme-10-7.png"))
    assertFalse(Themes.isPreviewOf("theme-10", "theme-1-7.png"))
  }

  @Test
  fun idsAndFit() {
    assertTrue(Themes.validId("theme-1"))
    for (bad in listOf("", "../x", "a/b", "A", "a.jpg", "a".repeat(41))) assertFalse(bad, Themes.validId(bad))
    assertEquals(1440 to 810, Themes.fit(4000, 2250, 1440))
    assertEquals(810 to 1440, Themes.fit(2250, 4000, 1440))
    assertEquals(800 to 600, Themes.fit(800, 600, 1440))
    assertEquals(1440 to 1, Themes.fit(1440 * 10, 5, 1440))
  }
}
