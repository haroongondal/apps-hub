package expo.modules.designmedia.applink

import android.content.Context
import android.content.pm.PackageManager
import android.os.Binder
import android.os.Process

/**
 * Canonical copy of the app-link caller check (copy-in, only the `package` line changes per app).
 * The signature permission in the manifest is the first gate; this is the second. A squatter that declares the permission
 * first does not hold it as ours: on Android 5+ the real app then fails to install (INSTALL_FAILED_DUPLICATE_PERMISSION), so
 * squatting is a denial of service, not a way in. The certificate re-check stays as defense against OEM or historical
 * custom-permission bugs: the caller's signing certificate must also equal this app's. Any failure to find out counts as "not allowed".
 *
 * PROVIDER METHODS ONLY, and call it synchronously on the binder thread (before any thread hop): inside an Activity, or on a
 * worker thread, `Binder.getCallingUid()` is the app's own uid, which would count as "self" and let anyone in.
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
