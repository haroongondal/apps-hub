package expo.modules.deputyagent.core

/** FR-4: the owner's choices from the Apps screen over [DefaultTrust]. Deputy stays blocked whatever is stored (safety rule 4). */
class TrustTable(private val self: String, private val overrides: Map<String, TrustLevel>) {
  fun level(pkg: String): TrustLevel = if (pkg == self) TrustLevel.BLOCKED else overrides[pkg] ?: DefaultTrust.level(pkg, self)

  fun financial(pkg: String) = DefaultTrust.level(pkg, self) == TrustLevel.READ_ONLY

  /** The overrides after the change. Throws [IllegalArgumentException] with copy for the screen when it isn't allowed. */
  fun set(pkg: String, level: TrustLevel, label: String, typed: String?): Map<String, TrustLevel> {
    require(pkg != self) { "Deputy can't operate itself, so it stays blocked." }
    require(level != TrustLevel.STANDARD || !financial(pkg) || typed?.trim().equals(label, ignoreCase = true)) {
      "Type $label to let Deputy tap and type in this money app."
    }
    return if (level == DefaultTrust.level(pkg, self)) overrides - pkg else overrides + (pkg to level)
  }
}
