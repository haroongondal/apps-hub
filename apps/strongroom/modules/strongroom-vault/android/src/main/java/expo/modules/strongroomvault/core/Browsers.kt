package expo.modules.strongroomvault.core

object Browsers {
  // Copied from https://www.gstatic.com/gpm-passkeys-privileged-apps/apps.json on 2026-10-30 (Chrome release and userdebug, Firefox release).
  val ALLOWLIST: Set<AppId> = setOf(
    AppId("com.android.chrome", "f0fd6c5b410f25cb25c3b53346c8972fae30f8ee7411df910480ad6b2d60db83"),
    AppId("com.android.chrome", "1975b2f17177bc89a5dff31f9e64a6cae281a53dc1d1d59b1d147fe1c82afa00"),
    AppId("org.mozilla.firefox", "a78b62a5165b4494b2fead9e76a280d22d937fee6251aece599446b2ea319b04"),
  )
}
