package expo.modules.strongroomvault.core

/**
 * A Wi-Fi network is a QR pass whose code is the standard `WIFI:` string (src/forms.ts wifiCode/parseWifi/editableWifi is the TypeScript twin).
 * Nothing here is stored; it only decides how a pass is shown and what may leave the phone.
 */
object Wifi {
  private const val PREFIX = "WIFI:"

  fun isWifiCode(code: String) = code.startsWith(PREFIX, ignoreCase = true)

  /** The password is in the code, so a Wi-Fi code is never presented over NFC. */
  fun mayPresent(code: String) = !isWifiCode(code)

  fun code(ssid: String, password: String, wpa: Boolean): String =
    if (wpa) "WIFI:T:WPA;S:${escape(ssid)};P:${escape(password)};;" else "WIFI:T:nopass;S:${escape(ssid)};;"

  /** True only when the Wi-Fi form could have written this pass: a QR whose code is exactly code(name, password, security). Anything else is edited as a plain pass. */
  fun editable(name: String, code: String, format: PassFormat): Boolean {
    if (format != PassFormat.QR || !code.startsWith(PREFIX)) return false
    val f = fields(code.substring(PREFIX.length))
    if (f["S"] == null) return false
    return code(name.trim(), f["P"] ?: "", f["T"] != "nopass") == code
  }

  private fun escape(s: String) = s.replace(Regex("""[\\;,:"]""")) { "\\" + it.value }

  // Splits on unescaped ';', each part at its first unescaped ':' (not at index 0); values are unescaped.
  private fun fields(body: String): Map<String, String> {
    val out = HashMap<String, String>()
    var part = StringBuilder()
    var key: String? = null
    var i = 0
    fun endPart() {
      val k = key
      if (k != null) out[k] = part.toString()
      part = StringBuilder()
      key = null
    }
    while (i < body.length) {
      val c = body[i]
      when {
        c == '\\' && i + 1 < body.length -> { part.append(body[i + 1]); i++ }
        c == ';' -> endPart()
        c == ':' && key == null && part.isNotEmpty() -> { key = part.toString(); part = StringBuilder() }
        else -> part.append(c)
      }
      i++
    }
    endPart()
    return out
  }
}
