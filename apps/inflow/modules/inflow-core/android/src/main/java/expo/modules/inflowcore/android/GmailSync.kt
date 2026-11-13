package expo.modules.inflowcore.android

import android.content.Context
import android.util.Log
import expo.modules.inflowcore.core.Email
import expo.modules.inflowcore.core.GmailPolicy
import expo.modules.inflowcore.core.Ingest
import jakarta.mail.FetchProfile
import jakarta.mail.FolderClosedException
import jakarta.mail.StoreClosedException
import jakarta.mail.UIDFolder
import jakarta.mail.search.FromStringTerm
import org.eclipse.angus.mail.imap.IMAPFolder
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

  const val AUTH_ERROR = GmailPolicy.AUTH_ERROR
  const val NETWORK_ERROR = GmailPolicy.NETWORK_ERROR
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
      // A refused password is not retried on a schedule (G7); "Check now" and a new sign-in still run.
      if (!GmailPolicy.scheduledMayRun(StoreHolder.get(ctx).getOrNull()?.meta(ERROR))) return
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
    var signedOut = false
    try {
      val ingest = StoreHolder.ingest(context, store) { InflowListener.schedulePurge(context, it) }
      var failed = false
      GmailClient.open(address, password).use { session ->
        for (sender in store.gmailSenders()) {
          try {
            imported += syncSender(store, ingest, session.folder, sender, address)
          } catch (e: SignedOut) {
            throw e
          } catch (e: FolderClosedException) {
            throw e   // the connection is gone: end the run
          } catch (e: StoreClosedException) {
            throw e
          } catch (e: Exception) {
            // One sender's failure must not stop the others; its cursor stays, so it is retried next time.
            Log.w(TAG, "sender sync failed: ${e.javaClass.simpleName}")
            failed = true
          }
        }
      }
      // Disconnect may have run meanwhile: then nothing of this run is written back (G11).
      store.inTransaction {
        if (signedIn(store, address)) {
          store.setMeta(LAST_SYNC_AT, System.currentTimeMillis().toString())
          if (failed) store.setMeta(ERROR, NETWORK_ERROR) else store.deleteMeta(ERROR)
        }
      }
    } catch (e: SignedOut) {
      // Disconnected mid-run.
      signedOut = true
    } catch (e: Exception) {
      Log.w(TAG, "sync failed: ${e.javaClass.simpleName}")
      store.inTransaction { if (signedIn(store, address)) store.setMeta(ERROR, GmailPolicy.errorCopy(e)) }
    } finally {
      running.set(false)
    }
    // A new account that connected during this run was refused by the running flag: sync it now (no-op when signed out).
    if (signedOut) schedule(context, 0)
    return imported
  }

  private class SignedOut : Exception()

  private fun signedIn(store: SqlItemStore, address: String) = store.meta(ADDRESS) == address

  private fun syncSender(store: SqlItemStore, ingest: Ingest, folder: IMAPFolder, sender: GmailSender, address: String): Int {
    val validity = folder.uidValidity
    val last = if (sender.uidValidity == validity) sender.lastUid else 0L
    val found = folder.search(FromStringTerm(sender.query))
    folder.fetch(found, FetchProfile().apply { add(UIDFolder.FetchProfileItem.UID) })
    val fresh = found.map { it to folder.getUID(it) }.filter { it.second > last }.sortedBy { it.second }
    if (fresh.isEmpty()) {
      if (sender.uidValidity != validity) store.inTransaction {
        if (!signedIn(store, address)) throw SignedOut()
        store.setGmailCursor(sender.query, validity, last)
      }
      return 0
    }
    var imported = 0
    for (batch in fresh.chunked(BATCH)) {
      folder.fetch(batch.map { it.first }.toTypedArray(), FetchProfile().apply { add(FetchProfile.Item.ENVELOPE) })
      // Network reads first, so the write lock is held only for the saves.
      // The IMAP search is a substring match: only the marked sender's own mail is kept (G1).
      val emails = batch.mapNotNull { (msg, _) -> Email.fromMessage(msg, MAX_BYTES) }.filter { Email.fromMatches(it, sender.query) }
      imported += store.inTransaction {
        if (!signedIn(store, address)) throw SignedOut()
        val n = emails.sumOf { ingest.onEmail(it, LABEL) }
        store.setGmailCursor(sender.query, validity, batch.last().second)
        n
      }
    }
    return imported
  }
}
