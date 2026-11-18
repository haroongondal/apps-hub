package expo.modules.strongroomvault.android

import android.content.ComponentName
import android.content.Context
import android.os.SystemClock
import expo.modules.strongroomvault.core.Ndef
import expo.modules.strongroomvault.core.Type4Tag

// One process-wide tag: the module thread arms it, the HCE service binder thread reads it. Type4Tag is synchronized.
object Presenting {
  private val tag = Type4Tag()

  @Synchronized fun arm(code: String): Boolean {
    val message = Ndef.forCode(code)
    return try {
      tag.arm(message, SystemClock.elapsedRealtime())
      true
    } catch (e: IllegalArgumentException) {
      disarm()
      false
    } finally {
      message.fill(0)
    }
  }

  @Synchronized fun disarm() = tag.disarm()

  fun isArmed(): Boolean = tag.isArmed(SystemClock.elapsedRealtime())

  fun process(apdu: ByteArray): ByteArray = tag.process(apdu, SystemClock.elapsedRealtime())

  val serviceComponent: (Context) -> ComponentName = { ComponentName(it, StrongroomTagService::class.java) }
}
