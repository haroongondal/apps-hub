package expo.modules.strongroomvault.core

import java.util.ArrayDeque

/**
 * Verification codes read from incoming text messages (DESIGN §15.3). The
 * extraction is conservative and bounded: a 4–8 digit run — or an alphanumeric
 * run that holds a digit — within a few words of a code, otp, pin, verification,
 * 2FA, confirmation or tasdeeq keyword, English and Roman-Urdu. The cache is
 * volatile memory only: at most the last few codes, each gone two minutes after
 * it arrived. Nothing here touches disk, logs or the vault, so it works while
 * the vault is locked — a code is not vault content.
 */
object SmsCodes {
  /** A code lives exactly this long after it arrives. */
  const val TTL_MS = 2 * 60 * 1000L

  data class Code(val code: String, val sender: String, val receivedAt: Long)

  private val cache = ArrayDeque<Code>()
  private const val MAX = 4
  private const val NEAR = 24
  private val KEYWORD = Regex("(?i)(?<![a-z0-9])(code|otp|pin|verification|verify|2\\s?fa|confirmation|confirm|tasdeeq|tasdiq|tasdeek)(?![a-z0-9])")
  private val DIGITS = Regex("(?<!\\d)\\d{4,8}(?!\\d)")
  private val ALNUM = Regex("(?<![0-9A-Za-z])[0-9A-Za-z]{4,8}(?![0-9A-Za-z])")

  /** The code a message names, or null when nothing code-like sits near a keyword. */
  fun extract(body: String): String? {
    val keywords = KEYWORD.findAll(body).map { it.range }.toList()
    if (keywords.isEmpty()) return null
    // Distance to the nearest keyword; a candidate the keyword overlaps counts as touching it.
    fun distance(r: IntRange): Int = keywords.minOf { k ->
      when {
        k.first in r || k.last in r -> 0
        r.first > k.last -> r.first - k.last
        else -> k.first - r.last
      }
    }
    fun near(r: IntRange) = distance(r) <= NEAR
    // Digits beat alphanumerics, and nearness beats position: an amount sitting near a keyword
    // never outshouts the real code, and a letter run is only ever a fallback.
    val digits = DIGITS.findAll(body).map { it.value to it.range }.filter { near(it.second) }.toList()
    if (digits.isNotEmpty()) return digits.minWith(compareBy({ distance(it.second) }, { it.second.first })).first
    val alnum = ALNUM.findAll(body).map { it.value to it.range }.filter { (v, r) -> v.any(Char::isDigit) && near(r) }
    return alnum.minWithOrNull(compareBy({ distance(it.second) }, { it.second.first }))?.first
  }

  /** Keeps [code] as the newest; the oldest falls out past a few. In-memory only, by design. */
  fun put(code: String, sender: String, receivedAt: Long) = synchronized(cache) {
    cache.addLast(Code(code, sender, receivedAt))
    while (cache.size > MAX) cache.removeFirst()
  }

  /** The newest code still inside its two minutes, or null. */
  fun freshest(nowMs: Long): Code? = synchronized(cache) {
    while (cache.isNotEmpty() && nowMs - cache.first().receivedAt > TTL_MS) cache.removeFirst()
    cache.lastOrNull()
  }

  /** Empties the cache: a turned-off toggle leaves nothing behind. */
  fun clear() = synchronized(cache) { cache.clear() }
}
