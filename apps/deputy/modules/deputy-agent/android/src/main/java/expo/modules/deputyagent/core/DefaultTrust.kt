package expo.modules.deputyagent.core

/** PRD FR-4 defaults, before the owner changes any app on the Apps screen. */
object DefaultTrust {
  private val BLOCKED = setOf(
    "com.haroon.store",
    "com.android.packageinstaller", "com.google.android.packageinstaller", "com.miui.packageinstaller",
    "com.x8bit.bitwarden", "com.bitwarden.authenticator", "com.agilebits.onepassword", "com.lastpass.lpandroid",
    "com.dashlane", "proton.android.pass", "keepass2android.keepass2android", "com.kunzisoft.keepass.free",
    "com.kunzisoft.keepass.libre", "com.google.android.apps.authenticator2", "com.azure.authenticator",
    "com.authy.authy", "com.beemdevelopment.aegis", "org.fedorahosted.freeotp",
  )
  private val MONEY = setOf(
    "com.revolut.revolut", "com.transferwise.android", "com.robinhood.android", "com.etoro.openbook",
    "com.binance.dev", "com.coinbase.android", "com.google.android.apps.nbu.paisa.user",
  )
  // shortcut: banks are guessed from package-name words; the owner's own banks may need setting by hand on the Apps screen.
  private val MONEY_WORDS = listOf("bank", "wallet", "pay", "invest", "broker", "trading", "finance", "crypto")

  fun level(pkg: String, self: String): TrustLevel = when {
    pkg == self || pkg in BLOCKED -> TrustLevel.BLOCKED
    pkg in MONEY || pkg.split('.').any { seg -> MONEY_WORDS.any { seg.contains(it) } } -> TrustLevel.READ_ONLY
    else -> TrustLevel.STANDARD
  }
}
