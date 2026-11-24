package expo.modules.opentunnelnative

// Android redacts both without location permission (or with location off); a redacted value is unknown, never a match.
object WifiIdentity {
  private const val UNKNOWN_SSID = "<unknown ssid>"
  private const val REDACTED_BSSID = "02:00:00:00:00:00"
  private val MAC = Regex("^[0-9a-f]{2}(:[0-9a-f]{2}){5}$")

  fun ssid(raw: String?): String? {
    if (raw == null || raw == UNKNOWN_SSID) return null
    val unquoted = if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) raw.substring(1, raw.length - 1) else raw
    return unquoted.ifEmpty { null }
  }

  fun bssid(raw: String?): String? = raw?.lowercase()?.takeIf { it != REDACTED_BSSID && MAC.matches(it) }
}
