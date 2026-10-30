package expo.modules.strongroomvault.core

import java.net.IDN
import java.util.Locale
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

sealed interface Requester {
  /** reportedDomain: the registrable domain (else the normalized host) a non-browser app reported as its webDomain; null if none. */
  data class App(val id: AppId, val reportedDomain: String?) : Requester

  data class Web(val site: Site) : Requester
}

object Matching {
  private val LABELS = Regex("[a-z0-9_-]+(\\.[a-z0-9_-]+)*")
  private val IPV6 = Regex("\\[[0-9a-f.]*:[0-9a-f:.]*\\]")
  private val PORT = Regex("[0-9]{1,5}")
  private val NUMERIC_LABEL = Regex("[0-9]+|0x[0-9a-f]*")
  private val URL = Regex("(https?)://([^/?#\\\\]*)(?:[/?#\\\\].*)?", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))

  fun normalizeHost(host: String): String? {
    val end = if (host.startsWith("[")) host.indexOf(']') + 1 else host.indexOf(':').let { if (it < 0) host.length else it }
    if (end <= 0) return null
    val name = host.substring(0, end)
    val rest = host.substring(end)
    val port = when {
      rest.isEmpty() -> null
      rest.startsWith(":") && PORT.matches(rest.substring(1)) && rest.substring(1).toInt() in 1..65535 -> rest.substring(1).toInt().toString()
      else -> return null
    }
    val normalized = (if (name.startsWith("[")) name.lowercase(Locale.ROOT).takeIf { IPV6.matches(it) } else dnsName(name)) ?: return null
    return if (port == null) normalized else "$normalized:$port"
  }

  fun registrableDomain(host: String): String? {
    val name = normalizeHost(host)?.substringBefore(':') ?: return null
    if (name.startsWith("[") || NUMERIC_LABEL.matches(name.substringAfterLast('.'))) return null
    return PublicSuffix.registrableDomain(name)
  }

  fun siteFromUrl(url: String): Site? {
    val m = URL.matchEntire(url.trim()) ?: return null
    return site(m.groupValues[1].equals("https", ignoreCase = true), m.groupValues[2].substringAfterLast('@'))
  }

  fun requester(pkg: String, certSha256: String?, webDomain: String?, webScheme: String?, browsers: Set<AppId>): Requester? {
    val id = try {
      AppId(pkg, certSha256 ?: return null)
    } catch (e: IllegalArgumentException) {
      return null
    }
    val domain = webDomain?.takeIf { it.isNotEmpty() }
    if (id in browsers) return domain?.let { site(webScheme.equals("https", ignoreCase = true), it) }?.let { Requester.Web(it) }
    return Requester.App(id, domain?.let { registrableDomain(it) ?: normalizeHost(it) ?: return null })
  }

  /** The one predicate: autofill, the match index and the unlock screen's re-check all go through it. */
  fun matches(sites: List<Site>, apps: List<AppLink>, r: Requester): Boolean = when (r) {
    is Requester.Web -> sites.any { siteMatches(it, r.site) }
    is Requester.App -> apps.any { it.app == r.id && it.domain == r.reportedDomain }
  }

  fun matches(login: Entry.Login, r: Requester): Boolean = matches(login.sites, login.apps, r)

  fun needsHostLabel(site: Site): Boolean {
    val host = normalizeHost(site.host) ?: return true
    return registrableDomain(host) == null || host.substringBefore(':').endsWith(".local")
  }

  private fun siteMatches(saved: Site, requested: Site): Boolean {
    if (saved.https && !requested.https) return false
    val a = normalizeHost(saved.host) ?: return false
    val b = normalizeHost(requested.host) ?: return false
    val ra = registrableDomain(a)
    val rb = registrableDomain(b)
    return if (ra != null && rb != null) ra == rb else ra == null && rb == null && a == b
  }

  private fun site(https: Boolean, hostAndPort: String): Site? =
    normalizeHost(hostAndPort)?.let { Site(https, it.removeSuffix(if (https) ":443" else ":80")) }

  private fun dnsName(name: String): String? {
    val ascii = try {
      IDN.toASCII(name.removeSuffix("."))
    } catch (e: IllegalArgumentException) {
      return null
    }
    return ascii.lowercase(Locale.ROOT).takeIf { LABELS.matches(it) }
  }
}

internal fun Requester.toJson(): JsonObject = buildJsonObject {
  when (this@toJson) {
    is Requester.App -> {
      put("kind", "app")
      put("pkg", id.pkg)
      put("certSha256", id.certSha256)
      put("domain", reportedDomain)
    }
    is Requester.Web -> {
      put("kind", "web")
      put("https", site.https)
      put("host", site.host)
    }
  }
}

internal fun JsonObject.requester(): Requester = when (string("kind")) {
  "app" -> Requester.App(AppId(string("pkg"), string("certSha256")), optString("domain"))
  "web" -> Requester.Web(site())
  else -> throw IllegalArgumentException("malformed field kind")
}
