package expo.modules.strongroomvault.core

object LockPolicy {
  // A clock that went backwards counts as expired: fail closed.
  fun expired(lastUsedAt: Long, now: Long, timeoutMinutes: Int): Boolean =
    now < lastUsedAt || now - lastUsedAt >= timeoutMinutes * 60_000L

  fun biometricAllowed(enabled: Boolean, passwordUnlockBoot: Int?, currentBoot: Int): Boolean =
    enabled && passwordUnlockBoot == currentBoot

  fun validTimeout(m: Int): Boolean = m == 1 || m == 5 || m == 15
}
