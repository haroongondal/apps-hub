package expo.modules.clipboardcore.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureGateTest {
  @Test fun `the same clip twice in a row is skipped`() {
    assertTrue(CaptureGate.skip("TYPE_VIEW_CLICKED", 7, last = 7, dismissed = null))
    assertTrue(CaptureGate.skip("app", 7, last = 7, dismissed = null))
  }

  @Test fun `a deleted clip is not brought back by opening the app`() {
    assertTrue(CaptureGate.skip("app", 7, last = null, dismissed = 7))
  }

  @Test fun `a deliberate copy of a deleted clip is saved again`() {
    assertFalse(CaptureGate.skip("TYPE_VIEW_CLICKED", 7, last = null, dismissed = 7))
    assertFalse(CaptureGate.skip("TYPE_NOTIFICATION_STATE_CHANGED", 7, last = null, dismissed = 7))
  }

  @Test fun `different text is always saved`() {
    assertFalse(CaptureGate.skip("app", 8, last = 7, dismissed = 7))
  }
}
