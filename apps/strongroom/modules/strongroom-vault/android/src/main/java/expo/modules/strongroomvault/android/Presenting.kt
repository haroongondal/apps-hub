package expo.modules.strongroomvault.android

import android.content.ComponentName
import android.content.Context
import android.os.SystemClock
import expo.modules.strongroomvault.core.Ndef
import expo.modules.strongroomvault.core.Type4Tag

// One process-wide tag: the module thread arms it, the HCE service binder thread reads it. Type4Tag is synchronized.
object Presenting {
  private val tag = Type4Tag()
  @Volatile private var armed = false
  @Volatile private var armedUntil = 0L

  @Synchronized fun arm(code: String): Boolean {
    val now = SystemClock.elapsedRealtime()
    return try {
      tag.arm(Ndef.forCode(code), now)
      armedUntil = now + Type4Tag.DEFAULT_TTL_MS
      armed = true
      true
    } catch (e: IllegalArgumentException) {
      disarm()
      false
    }
  }

  @Synchronized fun disarm() {
    tag.disarm()
    armed = false
    armedUntil = 0L
  }

  @Synchronized fun isArmed(): Boolean = armed && SystemClock.elapsedRealtime() < armedUntil

  fun process(apdu: ByteArray): ByteArray = tag.process(apdu, SystemClock.elapsedRealtime())

  val serviceComponent: (Context) -> ComponentName = { ComponentName(it, StrongroomTagService::class.java) }
}
