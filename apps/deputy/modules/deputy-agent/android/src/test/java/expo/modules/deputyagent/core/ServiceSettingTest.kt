package expo.modules.deputyagent.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ServiceSettingTest {
  private val pkg = "com.haroon.deputy"
  private val cls = "expo.modules.deputyagent.android.DeputyAccessibilityService"
  private fun enabled(setting: String?) = ServiceSetting.isEnabled(setting, pkg, cls)

  @Test fun nothingEnabledMeansOff() {
    assertFalse(enabled(null))
    assertFalse(enabled(""))
  }

  @Test fun fullComponentNameIsEnabled() = assertTrue(enabled("$pkg/$cls"))

  @Test fun findsItAmongOtherServices() =
    assertTrue(enabled("com.other/com.other.Svc:$pkg/$cls:com.third/.Svc"))

  @Test fun shortFormIsRelativeToThePackage() =
    assertTrue(ServiceSetting.isEnabled("$pkg/.Svc", pkg, "$pkg.Svc"))

  @Test fun anotherAppsServiceWithTheSameClassNameIsNotOurs() = assertFalse(enabled("com.other/$cls"))

  @Test fun anotherServiceOfOursIsNotTheAccessibilityService() = assertFalse(enabled("$pkg/$pkg.Other"))
}
