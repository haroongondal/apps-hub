package expo.modules.strongroomvault.core

/**
 * The logins whose authenticator code a fill response offers (DESIGN §15.2):
 * matching follows §7's rules exactly through [Matching.matcher], only logins
 * that hold a code qualify, and the list is sorted by name like the login
 * strip. A login whose code no longer computes is skipped, never a crash.
 */
object TotpFill {
  fun logins(entries: Collection<Entry>, requester: Requester, unixSeconds: Long): List<Pair<Entry.Login, String>> {
    val match = Matching.matcher(requester)
    return entries.filterIsInstance<Entry.Login>()
      .filter { match(it.sites, it.apps) }
      .sortedBy { it.name.lowercase() }
      .mapNotNull { login -> login.totp?.let { uri -> Otp.code(uri, unixSeconds)?.let { code -> login to code } } }
  }
}
