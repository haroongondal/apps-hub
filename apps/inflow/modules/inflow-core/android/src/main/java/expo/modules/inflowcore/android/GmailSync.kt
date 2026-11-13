package expo.modules.inflowcore.android

import android.content.Context
import android.util.Log
import expo.modules.inflowcore.core.Email
import expo.modules.inflowcore.core.Ingest
import expo.modules.inflowcore.core.RawEmail
import jakarta.mail.AuthenticationFailedException
import jakarta.mail.FetchProfile
import jakarta.mail.MessageRemovedException
import jakarta.mail.UIDFolder
import jakarta.mail.search.FromStringTerm
import org.eclipse.angus.mail.imap.IMAPFolder
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

data class GmailSender(val query: String, val uidValidity: Long?, val lastUid: Long)

/** Downloads emails from the marked senders. Runs on its own thread, never on the capture thread (R16). */
object GmailSync {
  const val ADDRESS = "gmailAddress"
  const val PASSWORD = "gmailPassword"
  const val LAST_SYNC_AT = "gmailLastSyncAt"
  const val ERROR = "gmailError"

  const val AUTH_ERROR = "Gmail refused the sign-in. Check the address, make a new app password and try again."
  const val NETWORK_ERROR = "Inflow could not reach Gmail. It will try again in a few minutes."
  const val ADDRESS_ERROR = "Enter your Gmail address."
  const val PASSWORD_ERROR = "An app password has 16 letters. Copy it again from your Google account."

  /** R13: the owner's two bank alert addresses, seeded on the first sign-in. */
  val DEFAULT_SENDERS = listOf("admin.ebanking@ubl.com.pk", "email.notification@bankalfalah.com")

  private const val TAG = "GmailSync"
  private const val BATCH = 20
  private const val MAX_BYTES = 2 * 1024 * 1024
  private const val LABEL = "Gmail"
  private const val PERIOD_MIN = 15L

  val executor = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "inflow-gmail").apply { isDaemon = true } }
  private val running = AtomicBoolean(false)
  private val pending = AtomicBoolean(false)
  private val periodic = AtomicBoolean(false)

  /** At most one waiting run: a second call before it fires is dropped (a burst of Gmail notifications is one sync). */
  fun schedule(ctx: Context, delayMs: Long) {
    if (!pending.compareAndSet(false, true)) return
    executor.schedule({ pending.set(false); runAndNotify(ctx) }, delayMs, TimeUnit.MILLISECONDS)
  }

  /** Every 15 minutes while the process lives; started once from the listener. */
  fun startPeriodic(ctx: Context) {
    if (!periodic.compareAndSet(false, true)) return
    executor.scheduleWithFixedDelay({ runAndNotify(ctx) }, 1, PERIOD_MIN, TimeUnit.MINUTES)
  }

  private fun runAndNotify(ctx: Context) {
    try {
      val n = sync(ctx)
      if (n > 0) StoreHolder.onCaptured?.invoke(n)
    } catch (e: Exception) {
      Log.w(TAG, "scheduled sync failed: ${e.javaClass.simpleName}")
    }
  }

  /** Items saved. 0 at once with no sign-in or when a sync is already running. */
  fun sync(context: Context): Int {
    val store = StoreHolder.get(context).getOrNull() ?: return 0
    val address = store.meta(ADDRESS)?.takeIf { it.isNotBlank() }
    val password = store.meta(PASSWORD)?.takeIf { it.isNotBlank() }
    if (address == null || password == null) return 0
    if (!running.compareAndSet(false, true)) return 0
    var imported = 0
    try {
      val ingest = StoreHolder.ingest(context, store) { InflowListener.schedulePurge(context, it) }
      GmailClient.open(address, password).use { session ->
        for (sender in store.gmailSenders()) imported += syncSender(store, ingest, session.folder, sender)
      }
      store.setMeta(LAST_SYNC_AT, System.currentTimeMillis().toString())
      store.deleteMeta(ERROR)
    } catch (e: Exception) {
      Log.w(TAG, "sync failed: ${e.javaClass.simpleName}")
      store.setMeta(ERROR, if (e is AuthenticationFailedException) AUTH_ERROR else NETWORK_ERROR)
    } finally {
      running.set(false)
    }
    return imported
  }

  private fun syncSender(store: SqlItemStore, ingest: Ingest, folder: IMAPFolder, sender: GmailSender): Int {
    val validity = folder.uidValidity
    val last = if (sender.uidValidity == validity) sender.lastUid else 0L
    val found = folder.search(FromStringTerm(sender.query))
    folder.fetch(found, FetchProfile().apply { add(UIDFolder.FetchProfileItem.UID) })
    val fresh = found.map { it to folder.getUID(it) }.filter { it.second > last }.sortedBy { it.second }
    if (fresh.isEmpty()) {
      if (sender.uidValidity != validity) store.setGmailCursor(sender.query, validity, last)
      return 0
    }
    var imported = 0
    for (batch in fresh.chunked(BATCH)) {
      folder.fetch(batch.map { it.first }.toTypedArray(), FetchProfile().apply { add(FetchProfile.Item.ENVELOPE) })
      // Network reads first, so the write lock is held only for the saves.
      val emails = batch.mapNotNull { (msg, _) -> read(msg) }
      imported += store.inTransaction {
        val n = emails.sumOf { ingest.onEmail(it, LABEL) }
        store.setGmailCursor(sender.query, validity, batch.last().second)
        n
      }
    }
    return imported
  }

  // Over 2 MB is skipped (the cursor still moves on); a message expunged meanwhile is gone, not an error.
  private fun read(msg: jakarta.mail.Message): RawEmail? = try {
    if (msg.size > MAX_BYTES) null
    else {
      val at = msg.receivedDate?.time ?: msg.sentDate?.time ?: System.currentTimeMillis()
      Email.read(ByteArrayOutputStream().also { msg.writeTo(it) }.toByteArray(), at)
    }
  } catch (e: MessageRemovedException) {
    null
  }
}
