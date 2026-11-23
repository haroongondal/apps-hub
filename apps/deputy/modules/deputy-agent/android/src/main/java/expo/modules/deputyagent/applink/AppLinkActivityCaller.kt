package expo.modules.deputyagent.applink

import android.app.Activity
import android.content.pm.PackageManager

// Canonical copy-in (only `package` changes). callingPackage is null unless the caller used startActivityForResult
// from an Activity, so a start from a service, a notification or a plain startActivity is always refused.
object AppLinkActivityCaller {
  fun allowedActivityCaller(callingPackage: String?, signaturesMatch: Boolean): Boolean =
    !callingPackage.isNullOrEmpty() && signaturesMatch

  fun allowed(activity: Activity): Boolean = runCatching {
    val caller = activity.callingPackage
    val signaturesMatch = !caller.isNullOrEmpty() &&
      activity.packageManager.checkSignatures(caller, activity.packageName) == PackageManager.SIGNATURE_MATCH
    allowedActivityCaller(caller, signaturesMatch)
  }.getOrDefault(false)
}
