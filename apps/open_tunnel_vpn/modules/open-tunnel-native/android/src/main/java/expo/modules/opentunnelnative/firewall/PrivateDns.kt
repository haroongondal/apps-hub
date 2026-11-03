package expo.modules.opentunnelnative.firewall

import android.content.ContentResolver
import android.provider.Settings

/** The phone's Private DNS setting, read from `Settings.Global`. Reading it needs no permission. */
object PrivateDns {

  // An unset value is Automatic because Android's own default is opportunistic.
  fun mode(value: String?): String = when (value) {
    "off" -> "off"
    "hostname" -> "strict"
    else -> "automatic"
  }

  fun read(resolver: ContentResolver): Map<String, Any?> {
    val mode = mode(Settings.Global.getString(resolver, "private_dns_mode"))
    val provider = if (mode == "strict") {
      Settings.Global.getString(resolver, "private_dns_specifier")?.takeIf { it.isNotBlank() }
    } else {
      null
    }
    return mapOf("mode" to mode, "provider" to provider)
  }
}
