package expo.modules.clipboardcore.core

import expo.modules.clipboardcore.core.CopySignal.ANNOUNCEMENT
import expo.modules.clipboardcore.core.CopySignal.NOTIFICATION_STATE_CHANGED
import expo.modules.clipboardcore.core.CopySignal.VIEW_CLICKED
import expo.modules.clipboardcore.core.CopySignal.WINDOW_STATE_CHANGED
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CopySignalTest {
  private val own = "com.haroon.clipboard"

  @Test fun `tap on Copy counts`() {
    assertTrue(CopySignal.isCopy(VIEW_CLICKED, "com.whatsapp", "[Copy] cd=null", own))
    assertTrue(CopySignal.isCopy(VIEW_CLICKED, "com.android.chrome", "[Copy link]", own))
  }

  @Test fun `copied toast and announcement count`() {
    assertTrue(CopySignal.isCopy(NOTIFICATION_STATE_CHANGED, "android", "[Copied to clipboard]", own))
    assertTrue(CopySignal.isCopy(ANNOUNCEMENT, "com.android.systemui", "[Copied]", own))
  }

  @Test fun `selection toolbar opening does not count`() {
    // The spike's loop: this window lists Copy but nothing was copied.
    assertFalse(CopySignal.isCopy(WINDOW_STATE_CHANGED, "com.google.android.contacts", "[Cut, Copy, Paste, Share, Select all]", own))
  }

  @Test fun `our own events never count`() {
    assertFalse(CopySignal.isCopy(VIEW_CLICKED, own, "[Copy]", own))
  }

  @Test fun `words that only contain cop do not count`() {
    assertFalse(CopySignal.isCopy(VIEW_CLICKED, "com.example", "[Copyright, Scope, Cops]", own))
  }

  @Test fun `only copy and clipboard wording is loggable`() {
    assertTrue(CopySignal.loggable("[Copied to clipboard]"))
    assertFalse(CopySignal.loggable("[my bank pin 1234]"))
  }

  @Test fun `kinds`() {
    assertEquals(ClipKind.SECRET, ClipKind.of(sensitive = true, text = "hunter2", uriMime = null))
    assertEquals(ClipKind.CODE, ClipKind.of(false, " 482913 ", null))
    assertEquals(ClipKind.TEXT, ClipKind.of(false, "48291 Main St", null))
    assertEquals(ClipKind.TEXT, ClipKind.of(false, "123", null))
    assertEquals(ClipKind.IMAGE, ClipKind.of(false, null, "image/png"))
    assertEquals(ClipKind.FILE, ClipKind.of(false, null, "application/pdf"))
    assertEquals(null, ClipKind.of(false, null, null))
    assertTrue(ClipKind.CODE.hidden && ClipKind.SECRET.hidden && !ClipKind.TEXT.hidden)
  }
}
