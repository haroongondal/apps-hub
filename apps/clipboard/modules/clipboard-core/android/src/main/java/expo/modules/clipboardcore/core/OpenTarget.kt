package expo.modules.clipboardcore.core

/** Which intent a smart action may launch for a URI, or null to refuse it. Only web links, the dialer and the map. */
object OpenTarget {
  const val VIEW = "view"
  const val BROWSE = "browse"
  const val DIAL = "dial"

  private val WEB = Regex("""^https?://[A-Za-z0-9.-]+(:\d{1,5})?(/[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]*)?$""")
  private val TEL = Regex("""^tel:\+?\d{3,15}$""")
  private val GEO = Regex("""^geo:0,0\?q=[A-Za-z0-9%._~-]{1,1800}$""")

  fun action(uri: String): String? = when {
    WEB.matches(uri) -> BROWSE
    TEL.matches(uri) -> DIAL
    GEO.matches(uri) -> VIEW
    else -> null
  }
}
