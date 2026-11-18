package expo.modules.pdfscan.core

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object ImageNames {
  fun clean(s: String): String =
    s.filter { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == ' ' || it == '_' || it == '-' }.trim().ifEmpty { "Scan" }

  fun galleryName(base: String, epochMs: Long, index: Int): String {
    val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date(epochMs))
    return "${clean(base)}-$stamp-${index + 1}.jpg"
  }
}
