package expo.modules.notchisland.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ListenerAccessTest {
  private val notch = "com.haroon.halo/expo.modules.haloengine.android.HaloListener"

  @Test fun listener_enabled_exact_match_only() {
    val list = "$notch:com.other/x.Y"
    assertTrue(listenerEnabled(list, notch))
    assertFalse(listenerEnabled(list, "${notch}X"))
  }

  @Test fun listener_enabled_null_or_blank_false() {
    assertFalse(listenerEnabled(null, notch))
    assertFalse(listenerEnabled("", notch))
  }
}
