package expo.modules.deputyagent.core

import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

object RetryAfter {
  /** A `Retry-After` header as milliseconds to wait: whole or fractional seconds, or an HTTP date counted from `nowMs`. */
  fun parse(header: String?, nowMs: Long): Long? {
    val value = header?.trim() ?: return null
    value.toDoubleOrNull()?.let { return (it * 1_000).toLong().coerceAtLeast(0) }
    val at = runCatching { ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() }.getOrNull() ?: return null
    return (at - nowMs).coerceAtLeast(0)
  }
}
