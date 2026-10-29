package expo.modules.deputyagent.core

import org.junit.Assert.assertEquals
import org.junit.Test

class DefaultTrustTest {
  private fun level(pkg: String) = DefaultTrust.level(pkg, self = "com.haroon.deputy")

  @Test fun blocksDeputyTheStoreInstallersAndPasswordApps() = listOf(
    "com.haroon.deputy", "com.haroon.store", "com.android.packageinstaller", "com.google.android.packageinstaller",
    "com.miui.packageinstaller", "com.x8bit.bitwarden", "com.google.android.apps.authenticator2", "com.beemdevelopment.aegis",
  ).forEach { assertEquals(it, TrustLevel.BLOCKED, level(it)) }

  @Test fun startsMoneyAppsReadOnly() = listOf(
    "com.meezanbank.mobile", "com.google.android.apps.walletnfcrel", "com.paypal.android.p2pmobile",
    "com.revolut.revolut", "com.robinhood.android", "com.binance.dev",
  ).forEach { assertEquals(it, TrustLevel.READ_ONLY, level(it)) }

  @Test fun everythingElseIsStandard() = listOf(
    "com.whatsapp", "com.google.android.gm", "com.android.settings", "com.spotify.music", "com.google.android.deskclock",
  ).forEach { assertEquals(it, TrustLevel.STANDARD, level(it)) }
}
