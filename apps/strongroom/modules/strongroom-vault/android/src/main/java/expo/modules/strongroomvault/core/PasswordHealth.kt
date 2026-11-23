package expo.modules.strongroomvault.core

import java.nio.ByteBuffer
import java.security.MessageDigest
import kotlin.math.ln

enum class HealthFlag(val id: String) {
  TOO_SHORT("short"),
  ONLY_DIGITS("digits"),
  KEYBOARD_RUN("run"),
  REPEATS("repeats"),
  HAS_NAME("name"),
  COMMON("common"),
  REUSED("reused"),
}

data class HealthItem(val id: String, val flags: Set<HealthFlag>, val reuseGroup: Int)

data class HealthReport(val checked: Int, val items: List<HealthItem>) {
  val weak: Int get() = items.count { it.flags.any(HealthFlag::weakness) }
  val reused: Int get() = items.count { HealthFlag.REUSED in it.flags }
  val common: Int get() = items.count { HealthFlag.COMMON in it.flags }
}

private val HealthFlag.weakness get() = this != HealthFlag.COMMON && this != HealthFlag.REUSED

object PasswordHealth {
  const val MIN_BITS = 50.0
  private const val MIN_RUN = 4
  private const val MIN_NAME = 4
  private const val MAX_ADDED_SUFFIX = 4
  private val SEQUENCES = listOf("abcdefghijklmnopqrstuvwxyz", "0123456789", "1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm")
    .flatMap { listOf(it, it.reversed()) }

  fun check(entries: Map<String, Entry>, common: Set<String>): HealthReport {
    val logins = entries.mapNotNull { (id, e) -> (e as? Entry.Login)?.takeIf { it.password.isNotEmpty() }?.let { id to it } }.sortedBy { it.first }
    val groups = reuseGroups(logins)
    val items = logins.mapNotNull { (id, login) ->
      val group = groups[id] ?: 0
      val flags = flags(login, common) + if (group > 0) setOf(HealthFlag.REUSED) else emptySet()
      flags.takeIf { it.isNotEmpty() }?.let { HealthItem(id, it, group) }
    }
    return HealthReport(logins.size, items)
  }

  fun flags(login: Entry.Login, common: Set<String>): Set<HealthFlag> {
    val pw = login.password
    val lower = pw.lowercase()
    val found = mutableSetOf<HealthFlag>()
    if (bits(pw) < MIN_BITS) found += HealthFlag.TOO_SHORT
    if (pw.all(Char::isDigit)) found += HealthFlag.ONLY_DIGITS
    if (mostly(lower.length, runCover(lower))) found += HealthFlag.KEYBOARD_RUN
    if (mostly(lower.length, repeatCover(lower))) found += HealthFlag.REPEATS
    if (names(login).any { it in lower }) found += HealthFlag.HAS_NAME
    if (isCommon(lower, common)) found += HealthFlag.COMMON
    return found
  }

  fun bits(pw: String): Double {
    val pool = (if (pw.any(Char::isLowerCase)) 26 else 0) +
      (if (pw.any(Char::isUpperCase)) 26 else 0) +
      (if (pw.any(Char::isDigit)) 10 else 0) +
      (if (pw.any { !it.isLetterOrDigit() }) 33 else 0)
    if (pool == 0) return 0.0
    return pw.length * ln(pool.toDouble()) / ln(2.0)
  }

  // Also a listed password with up to four digits or symbols added at the end ("summer2024!"), the commonest way people vary one.
  fun isCommon(lower: String, common: Set<String>): Boolean {
    if (lower in common) return true
    val stem = lower.trimEnd { !it.isLetter() }
    val added = lower.length - stem.length
    return added in 1..MAX_ADDED_SUFFIX && stem.length >= MIN_NAME && stem in common
  }

  private fun mostly(length: Int, covered: BooleanArray) = length > 0 && covered.count { it } * 2 >= length

  private fun runCover(s: String): BooleanArray {
    val covered = BooleanArray(s.length)
    for (i in s.indices) {
      val longest = SEQUENCES.maxOf { seq -> runAt(s, i, seq) }
      if (longest >= MIN_RUN) for (k in i until i + longest) covered[k] = true
    }
    return covered
  }

  private fun runAt(s: String, i: Int, seq: String): Int {
    val start = seq.indexOf(s[i])
    if (start < 0) return 0
    var n = 1
    while (i + n < s.length && start + n < seq.length && s[i + n] == seq[start + n]) n++
    return n
  }

  private fun repeatCover(s: String): BooleanArray {
    val n = s.length
    val period = (1..n / 2).firstOrNull { p -> n % p == 0 && s == s.substring(0, p).repeat(n / p) }
    if (period != null) return BooleanArray(n) { true }
    val covered = BooleanArray(n)
    var i = 0
    while (i < n) {
      var j = i
      while (j < n && s[j] == s[i]) j++
      if (j - i >= 3) for (k in i until j) covered[k] = true
      i = j
    }
    return covered
  }

  private fun names(login: Entry.Login): Set<String> {
    val user = login.username.substringBefore('@').lowercase()
    val sites = login.sites.map { site -> (PublicSuffix.registrableDomain(site.host) ?: site.host).substringBefore('.') }
    val entry = login.name.lowercase().filter(Char::isLetterOrDigit)
    return (sites + user + entry).filter { it.length >= MIN_NAME }.toSet()
  }

  // The hashes live in this call only and are never stored or logged; groups are numbered from 1, biggest first.
  private fun reuseGroups(logins: List<Pair<String, Entry.Login>>): Map<String, Int> {
    val byHash = HashMap<ByteBuffer, MutableList<String>>()
    for ((id, login) in logins) byHash.getOrPut(digest(login.password)) { mutableListOf() } += id
    val shared = byHash.values.filter { it.size > 1 }.sortedWith(compareByDescending<List<String>> { it.size }.thenBy { it.first() })
    byHash.clear()
    return shared.withIndex().flatMap { (i, ids) -> ids.map { it to i + 1 } }.toMap()
  }

  private fun digest(password: String): ByteBuffer {
    val bytes = password.toByteArray(Charsets.UTF_8)
    try {
      return ByteBuffer.wrap(MessageDigest.getInstance("SHA-256").digest(bytes))
    } finally {
      bytes.fill(0)
    }
  }
}

object CommonPasswords {
  val set: Set<String> by lazy {
    val stream = CommonPasswords::class.java.getResourceAsStream("/common_passwords.txt") ?: error("common_passwords.txt is missing")
    stream.bufferedReader(Charsets.UTF_8).useLines { lines -> lines.filter { it.isNotEmpty() && !it.startsWith("//") }.toHashSet() }
  }
}
