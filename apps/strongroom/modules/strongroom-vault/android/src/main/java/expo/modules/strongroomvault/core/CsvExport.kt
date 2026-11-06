package expo.modules.strongroomvault.core

import java.util.Base64

/** Google Passwords' five columns first, so other managers read the logins; the rest carry cards and notes, which GoogleImport reads back. */
object CsvExport {
  val HEADER = listOf("name", "url", "username", "password", "note", "type", "holder", "number", "exp_month", "exp_year", "cvc", "app_domain")

  fun csv(entries: Collection<Entry>): String = Csv.format(listOf(HEADER) + entries.flatMap(::rows).sortedBy { it[0].lowercase() })

  // One row per site and app, as Google's own export does, so a login with several links loses none of them.
  private fun rows(e: Entry): List<List<String>> = when (e) {
    is Entry.Login -> (e.sites.map { (if (it.https) "https://" else "http://") + it.host to "" } + e.apps.map { androidUrl(it.app) to (it.domain ?: "") })
      .ifEmpty { listOf("" to "") }
      .map { (url, domain) -> listOf(e.name, url, e.username, e.password, e.note, "login", "", "", "", "", "", domain) }
    is Entry.Card -> listOf(listOf(e.name, "", "", "", e.note, "card", e.holder, e.number, e.expMonth?.toString() ?: "", e.expYear?.toString() ?: "", e.cvc, ""))
    is Entry.Note -> listOf(listOf(e.name, "", "", "", e.text, "note", "", "", "", "", "", ""))
    is Entry.Deleted -> emptyList()
  }

  private fun androidUrl(a: AppId) =
    "android://" + Base64.getEncoder().encodeToString(a.certSha256.chunked(2).map { it.toInt(16).toByte() }.toByteArray()) + "@" + a.pkg + "/"
}
