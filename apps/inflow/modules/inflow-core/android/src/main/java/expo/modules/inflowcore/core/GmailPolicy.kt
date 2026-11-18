package expo.modules.inflowcore.core

import jakarta.mail.AuthenticationFailedException

object GmailPolicy {
  const val AUTH_ERROR = "Gmail refused the sign-in. Check the address, make a new app password and try again."
  const val NETWORK_ERROR = "Inflow could not reach Gmail. It will try again in a few minutes."

  /** Only a refused password gets the auth copy; a transient LOGIN "NO" (Gmail says [UNAVAILABLE] and so on) is a network problem. */
  fun errorCopy(e: Exception): String =
    if (e is AuthenticationFailedException && e.message.orEmpty().contains("AUTHENTICATIONFAILED")) AUTH_ERROR else NETWORK_ERROR

  /** A refused password is retried only when the owner asks ("Check now") or reconnects, never by the schedule. */
  fun scheduledMayRun(error: String?): Boolean = error != AUTH_ERROR
}
