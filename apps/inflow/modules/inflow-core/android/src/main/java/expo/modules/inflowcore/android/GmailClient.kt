package expo.modules.inflowcore.android

import jakarta.mail.Folder
import jakarta.mail.Session
import jakarta.mail.Store
import org.eclipse.angus.mail.imap.IMAPFolder
import java.util.Properties

/** The only network code in Inflow: IMAP over TLS to imap.gmail.com:993. */
object GmailClient {
  private const val HOST = "imap.gmail.com"
  private const val PORT = 993

  /** The app password is shown in groups of four; spaces are never part of it. */
  fun clean(password: String): String = password.filterNot(Char::isWhitespace)

  class Opened(val store: Store, val folder: IMAPFolder) : AutoCloseable {
    override fun close() {
      runCatching { folder.close(false) }
      runCatching { store.close() }
    }
  }

  private fun connect(address: String, password: String): Store {
    val props = Properties().apply {
      put("mail.imaps.ssl.checkserveridentity", "true")
      put("mail.imaps.connectiontimeout", "20000")
      put("mail.imaps.timeout", "60000")
      put("mail.imaps.peek", "true")   // reading a body must never mark it read
    }
    val store = Session.getInstance(props).getStore("imaps")
    try {
      store.connect(HOST, PORT, address, clean(password))
    } catch (e: Exception) {
      runCatching { store.close() }
      throw e
    }
    return store
  }

  /** Signs in and out; throws AuthenticationFailedException on a wrong password. */
  fun check(address: String, password: String) {
    connect(address, password).close()
  }

  /** The folder with the \All attribute (Gmail's All Mail, so filtered emails count), else INBOX, read-only. */
  fun open(address: String, password: String): Opened {
    val store = connect(address, password)
    try {
      val all = store.defaultFolder.list("*").firstOrNull { f ->
        (f as? IMAPFolder)?.attributes?.any { it.equals("\\All", ignoreCase = true) } == true
      }
      val folder = (all ?: store.getFolder("INBOX")) as IMAPFolder
      folder.open(Folder.READ_ONLY)
      return Opened(store, folder)
    } catch (e: Exception) {
      runCatching { store.close() }
      throw e
    }
  }
}
