package expo.modules.inflowcore.core

/** Which apps open a contact list instead of one flat list: people send their messages, not the app itself. */
object ContactApps {
  const val TEAMS = "com.microsoft.teams"

  fun byContact(pkg: String, sms: Set<String>, hasChats: Boolean): Boolean =
    hasChats || pkg in sms || pkg == Email.GMAIL || pkg == TEAMS
}
