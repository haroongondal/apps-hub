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

  @Test fun service_enabled_full_or_short_form_only() {
    val pkg = "com.haroon.halo"
    val cls = "expo.modules.notchisland.android.NotchAccessibilityService"
    assertTrue(serviceEnabled("com.other/x.Y:$pkg/$cls", pkg, cls))
    assertFalse(serviceEnabled("$pkg/${cls}X", pkg, cls))
    assertFalse(serviceEnabled("com.haroon.halo2/$cls", pkg, cls))
    assertFalse(serviceEnabled(null, pkg, cls))
    assertTrue(serviceEnabled("$pkg/.svc.A", pkg, "$pkg.svc.A"))
    assertTrue(serviceEnabled("$pkg/$pkg.svc.A", pkg, "$pkg.svc.A"))
  }
}
