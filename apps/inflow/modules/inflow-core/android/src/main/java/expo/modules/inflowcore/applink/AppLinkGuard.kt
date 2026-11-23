package expo.modules.inflowcore.applink

/**
 * Canonical copy of the app-link guard. Every app copies this file with ONLY the `package` line changed
 * (packages/app-link-contract/src/__tests__/copies.test.ts fails when a copy drifts). Pure Kotlin: no android.* imports,
 * so JVM tests run it. It mirrors packages/app-link-contract/src/caller.ts (decide) and action.ts (limits, validateExtras);
 * both sides read the same fixtures. Everything here fails closed and never throws.
 */
object AppLinkGuard {
  const val PERMISSION = "com.haroon.permission.AUTOPILOT"

  // Equal to fixtures/limits.json.
  const val MAX_EXTRAS = 8
  const val MAX_STRING_CHARS = 2000
  const val MAX_ARRAY_ITEMS = 20
  const val MAX_ARRAY_ITEM_CHARS = 200
  const val MAX_TOTAL_CHARS = 8000
  const val MAX_RESULT_MESSAGE_CHARS = 200

  // Number.MAX_SAFE_INTEGER, so a long means the same on both sides.
  private const val MAX_SAFE_LONG = 9007199254740991L

  enum class Reason { SELF, OK, NO_PERMISSION, SIGNATURE_MISMATCH }

  data class Decision(val allow: Boolean, val reason: Reason)

  /** Self is allowed; no permission is denied; the permission without the same signing certificate is denied (a hostile app can squat the permission name). */
  fun decide(isSelf: Boolean, holdsPermission: Boolean, signatureMatches: Boolean): Decision = when {
    isSelf -> Decision(true, Reason.SELF)
    !holdsPermission -> Decision(false, Reason.NO_PERMISSION)
    !signatureMatches -> Decision(false, Reason.SIGNATURE_MISMATCH)
    else -> Decision(true, Reason.OK)
  }

  enum class ExtraType { STRING, LONG, BOOLEAN, STRING_ARRAY }

  /** `max` only lowers a limit: chars for a string (1..MAX_STRING_CHARS), items for a string array (1..MAX_ARRAY_ITEMS). A long or boolean takes none. */
  data class ExtraSpec(val type: ExtraType, val max: Int? = null, val required: Boolean = false)

  sealed interface ExtrasCheck {
    data class Ok(val extras: Map<String, Any>) : ExtrasCheck
    data class Rejected(val reason: String) : ExtrasCheck
  }

  /**
   * Checks the extras of an incoming intent (`raw` is built from its extras bundle). Strings come back untouched, but a NUL is refused.
   * Lengths count UTF-16 units. A LONG extra takes a Long, an Int, or a Double that is a whole number (the React Native bridge sends
   * every number as a Double); it comes back as a Long. A spec whose `max` is out of range is refused here, it never throws out.
   */
  fun validateExtras(spec: Map<String, ExtraSpec>, raw: Map<String, Any?>): ExtrasCheck =
    runCatching { check(spec, raw) }.getOrElse { ExtrasCheck.Rejected("extras could not be read") }

  private fun check(spec: Map<String, ExtraSpec>, raw: Map<String, Any?>): ExtrasCheck {
    fun no(reason: String) = ExtrasCheck.Rejected(reason)
    for ((key, s) in spec) badMax(s)?.let { return no("bad spec for $key: $it") }
    if (raw.size > MAX_EXTRAS) return no("more than $MAX_EXTRAS extras")
    raw.keys.firstOrNull { it !in spec }?.let { return no("unknown extra $it") }
    var total = 0
    val out = LinkedHashMap<String, Any>()
    for ((key, s) in spec) {
      if (!raw.containsKey(key)) {
        if (s.required) return no("missing extra $key")
        continue
      }
      val value = raw[key]
      when (s.type) {
        ExtraType.LONG -> {
          val n = (value as? Long) ?: (value as? Int)?.toLong() ?: (value as? Double)?.takeIf { it.isFinite() && it == Math.floor(it) && Math.abs(it) <= MAX_SAFE_LONG.toDouble() }?.toLong()
          if (n == null || n > MAX_SAFE_LONG || n < -MAX_SAFE_LONG) return no("$key must be a whole number")
          out[key] = n
        }
        ExtraType.BOOLEAN -> out[key] = value as? Boolean ?: return no("$key must be true or false")
        ExtraType.STRING -> {
          val str = value as? String ?: return no("$key must be text")
          if (str.length > (s.max ?: MAX_STRING_CHARS)) return no("$key is too long")
          if ('\u0000' in str) return no("$key contains a NUL character")
          total += str.length
          out[key] = str
        }
        ExtraType.STRING_ARRAY -> {
          val items = (value as? List<*>) ?: (value as? Array<*>)?.toList()
          if (items == null || !items.all { it is String }) return no("$key must be a list of text")
          if (items.size > (s.max ?: MAX_ARRAY_ITEMS)) return no("$key has too many items")
          for (item in items) {
            item as String
            if (item.length > MAX_ARRAY_ITEM_CHARS) return no("$key has an item that is too long")
            if ('\u0000' in item) return no("$key contains a NUL character")
            total += item.length
          }
          out[key] = items.map { it as String }
        }
      }
    }
    if (total > MAX_TOTAL_CHARS) return no("extras hold more than $MAX_TOTAL_CHARS characters")
    return ExtrasCheck.Ok(out)
  }

  /** Why a spec's `max` is out of range, or null when it is fine. */
  private fun badMax(s: ExtraSpec): String? {
    val max = s.max ?: return null
    val limit = when (s.type) {
      ExtraType.STRING -> MAX_STRING_CHARS
      ExtraType.STRING_ARRAY -> MAX_ARRAY_ITEMS
      else -> return "a ${s.type.name.lowercase()} takes no max"
    }
    return if (max in 1..limit) null else "max must be 1 to $limit, got $max"
  }
}
