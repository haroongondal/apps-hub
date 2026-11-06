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

  // place: what the login is for. A linked login uses its sites and apps; an unlinked one its raw URL (else its name), so unrelated ones never pool.
  private class Row(val place: List<Any>, val importedFrom: String?, val login: Entry.Login)

  fun parse(csv: String, now: Long): ImportResult {
    val records = try {
      Csv.parse(csv)
    } catch (e: IllegalArgumentException) {
      throw ImportError(DAMAGED)
    }.filterNot { row -> row.all { it.isEmpty() } }
    val header = records.firstOrNull()?.map { it.trim().lowercase(Locale.ROOT) } ?: throw ImportError(NOT_GOOGLE)
    val (nameAt, urlAt, userAt, passAt) = listOf("name", "url", "username", "password").map { header.indexOf(it) }
    if (minOf(nameAt, urlAt, userAt, passAt) < 0) throw ImportError(NOT_GOOGLE)
    val noteAt = header.indexOf("note")

    val rows = records.drop(1).mapIndexed { n, row ->
      if (row.size > header.size) {
        throw ImportError("Row ${n + 1} of this file has more columns than its header, so a value may be split. Export again from Google Password Manager.")
      }
      fun cell(at: Int) = row.getOrElse(at) { "" }
      val url = cell(urlAt).trim()
      val name = cell(nameAt)
      val site = Matching.siteFromUrl(url)
      val android = androidUrl(url)
      val app = android?.let { (b64, pkg) -> sha256(b64)?.let { AppLink(AppId(pkg, hex(it)), null) } }
      val unlinked = site == null && app == null
      Row(
        place = when {
          !unlinked -> listOf(listOfNotNull(site), listOfNotNull(app))
          url.isNotEmpty() -> listOf("url", url)
          else -> listOf("name", name.trim())
        },
        importedFrom = url.takeIf { unlinked && it.isNotEmpty() },
        login = Entry.Login(
          name = name.ifBlank { site?.let { Matching.registrableDomain(it.host) ?: it.host } ?: android?.second ?: "" },
          username = cell(userAt),
          password = cell(passAt),
          sites = listOfNotNull(site),
          apps = listOfNotNull(app),
          note = cell(noteAt),
          updatedAt = now,
        ),
      )
    }

    val groups = rows.groupBy { listOf(it.place, it.login.username, it.login.password) }.values
    val shared = groups.groupingBy { it.first().place to it.first().login.username }.eachCount().filterValues { it > 1 }.keys
    var flagged = 0
    val logins = groups.map { group ->
      val first = group.first()
      val isFlagged = (first.place to first.login.username) in shared
      if (isFlagged) flagged++
      val lines = group.map { it.login.note }.filter { it.isNotBlank() }.distinct() + listOfNotNull(first.importedFrom?.let { "Imported from $it" })
      first.login.copy(note = (if (isFlagged) FLAG_PREFIX else "") + lines.joinToString("\n"))
    }
    return ImportResult(logins, merged = rows.size - groups.size, flagged = flagged)
  }

  /** (base64 hash, package) of an `android://<hash>@<package>/` URL, or null; the hash may contain '/' but never '@', so split on the first '@'. */
  private fun androidUrl(url: String): Pair<String, String>? {
    if (!url.startsWith(ANDROID, ignoreCase = true)) return null
    val rest = url.substring(ANDROID.length)
    val at = rest.indexOf('@')
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
