package expo.modules.strongroomvault.core

import java.util.Base64
import java.util.Locale

data class ImportResult(val logins: List<Entry.Login>, val merged: Int, val flagged: Int)

class ImportError(message: String) : Exception(message)

object GoogleImport {
  private const val NOT_GOOGLE = "This file isn't a Google Passwords export. Export again from Google Password Manager and pick that file."
  private const val DAMAGED = "This file is damaged: a quoted field never ends. Export again from Google Password Manager."
  private const val FLAG_PREFIX = "Imported twice with different passwords. Delete the wrong one.\n"
  private const val ANDROID = "android://"
  private val PACKAGE = Regex("[A-Za-z0-9_.]+")

  fun parse(csv: String, now: Long): ImportResult {
    val records = try {
      Csv.parse(csv)
    } catch (e: IllegalArgumentException) {
      throw ImportError(DAMAGED) // the message must never carry file content
    }.filterNot { row -> row.all { it.isEmpty() } }
    val header = records.firstOrNull()?.map { it.trim().lowercase(Locale.ROOT) } ?: throw ImportError(NOT_GOOGLE)
    val (nameAt, urlAt, userAt, passAt) = listOf("name", "url", "username", "password").map { header.indexOf(it) }
    if (minOf(nameAt, urlAt, userAt, passAt) < 0) throw ImportError(NOT_GOOGLE)
    val noteAt = header.indexOf("note")

    val logins = records.drop(1).map { row ->
      fun cell(at: Int) = row.getOrElse(at) { "" }
      val url = cell(urlAt).trim()
      val site = Matching.siteFromUrl(url)
      val android = androidUrl(url)
      val app = android?.let { (b64, pkg) -> sha256(b64)?.let { AppLink(AppId(pkg, hex(it)), null) } }
      Entry.Login(
        name = cell(nameAt).ifBlank { site?.let { Matching.registrableDomain(it.host) ?: it.host } ?: android?.second ?: "" },
        username = cell(userAt),
        password = cell(passAt),
        sites = listOfNotNull(site),
        apps = listOfNotNull(app),
        note = cell(noteAt),
        updatedAt = now,
      )
    }

    val seen = HashSet<List<Any>>()
    val unique = logins.filter { seen.add(listOf(it.sites, it.apps, it.username, it.password)) }
    fun place(l: Entry.Login) = Triple(l.sites, l.apps, l.username)
    val shared = unique.groupingBy(::place).eachCount().filterValues { it > 1 }.keys
    val out = unique.map { if (place(it) in shared) it.copy(note = FLAG_PREFIX + it.note) else it }
    return ImportResult(out, merged = logins.size - unique.size, flagged = unique.count { place(it) in shared })
  }

  /** (base64 hash, package) of an `android://<hash>@<package>/` URL, or null; the hash may contain '/', so split on the last '@'. */
  private fun androidUrl(url: String): Pair<String, String>? {
    if (!url.startsWith(ANDROID, ignoreCase = true)) return null
    val rest = url.substring(ANDROID.length)
    val at = rest.lastIndexOf('@')
    if (at < 0) return null
    val pkg = rest.substring(at + 1).substringBefore('/')
    return if (PACKAGE.matches(pkg)) rest.substring(0, at) to pkg else null
  }

  private fun sha256(b64: String): ByteArray? {
    val bytes = try {
      Base64.getDecoder().decode(b64)
    } catch (e: IllegalArgumentException) {
      try {
        Base64.getUrlDecoder().decode(b64)
      } catch (e2: IllegalArgumentException) {
        return null
      }
    }
    return bytes.takeIf { it.size == 32 }
  }

  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
}
