package expo.modules.aihubcore.android

import android.content.Context
import android.content.pm.PackageManager
import android.os.Process
import expo.modules.aihubcore.core.Decision
import expo.modules.aihubcore.core.decideCallers

class Caller(val uid: Int, val pkg: String, val decision: Decision)

object Callers {
  // `uid` must come from Binder.getCallingUid() on the binder thread.
  fun identify(context: Context, uid: Int, switches: Map<String, Boolean>): Caller {
    val pm = context.packageManager
    val pkgs = pm.getPackagesForUid(uid)?.toList().orEmpty()
    val same = pm.checkSignatures(Process.myUid(), uid) == PackageManager.SIGNATURE_MATCH
    return Caller(uid, pkgs.firstOrNull().orEmpty(), decideCallers(pkgs, same, switches, context.packageName))
  }
}
