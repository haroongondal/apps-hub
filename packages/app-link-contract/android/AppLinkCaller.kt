package applink

import android.content.Context
import android.content.pm.PackageManager
import android.os.Binder
import android.os.Process

/**
 * Canonical copy of the app-link caller check (copy-in, only the `package` line changes per app).
 * The signature permission in the manifest is the first gate; this is the second. Another app can squat the permission name
 * (declare it first, with a different signing key) and so hold it, so the caller's signing certificate must also equal this
 * app's. Any failure to find out counts as "not allowed".
 */
object AppLinkCaller {
  fun allowed(context: Context): Boolean = runCatching {
    val caller = Binder.getCallingUid()
    val me = Process.myUid()
    AppLinkGuard.decide(
      isSelf = caller == me,
      holdsPermission = context.checkCallingPermission(AppLinkGuard.PERMISSION) == PackageManager.PERMISSION_GRANTED,
      signatureMatches = context.packageManager.checkSignatures(caller, me) == PackageManager.SIGNATURE_MATCH,
    ).allow
  }.getOrDefault(false)
}
