package expo.modules.strongroomvault.core

/** What the link prompt may show: a package name or a registrable domain, never an app label or page title the requester chose. */
data class LinkPrompt(val pkg: String?, val domain: String?, val installedFromFile: Boolean, val refusal: String?) {
  companion object {
    private const val SAME_PACKAGE_OTHER_CERT =
      "This app has the same name as the saved one but a different signature. It may be fake. Strongroom won't fill it."

    fun build(login: Entry.Login, r: Requester, installedFromFile: Boolean): LinkPrompt = when (r) {
      is Requester.App -> LinkPrompt(
        r.id.pkg,
        r.reportedDomain,
        installedFromFile,
        SAME_PACKAGE_OTHER_CERT.takeIf { login.apps.any { it.app.pkg == r.id.pkg && it.app.certSha256 != r.id.certSha256 } },
      )
      is Requester.Web -> LinkPrompt(null, Matching.registrableDomain(r.site.host) ?: Matching.normalizeHost(r.site.host), false, null)
    }
  }
}
