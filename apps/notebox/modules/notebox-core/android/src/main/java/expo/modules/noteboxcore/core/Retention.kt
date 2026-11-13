package expo.modules.noteboxcore.core

object Retention {
  const val STRONGROOM = "com.haroon.strongroom"

  val KEEP_FOREVER: Set<String> = setOf(
    "com.google.android.apps.messaging",
    "com.android.mms",
    "com.google.android.gm",
    "com.whatsapp",
    "com.whatsapp.w4b",
    "org.telegram.messenger",
    "org.thoughtcrime.securesms",
    "com.facebook.orca",
  )

  val CHOICES: List<Int?> = listOf(null, 365, 90, 30)

  fun default(pkg: String, label: String): AppSetting =
    AppSetting(pkg, label, record = pkg != STRONGROOM, keepDays = if (pkg in KEEP_FOREVER) null else 90)
}
