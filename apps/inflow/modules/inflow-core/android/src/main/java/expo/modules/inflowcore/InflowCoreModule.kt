package expo.modules.inflowcore

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import android.util.Base64
import android.webkit.MimeTypeMap
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.FileProvider
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.inflowcore.android.AiConfig
import expo.modules.inflowcore.android.AiRunner
import expo.modules.inflowcore.android.Lock
import expo.modules.inflowcore.android.GmailClient
import expo.modules.inflowcore.android.GmailSync
import expo.modules.inflowcore.android.InflowListener
import expo.modules.inflowcore.android.MediaStore
import expo.modules.inflowcore.android.SqlMediaIndex
import expo.modules.inflowcore.android.SmsImporter
import expo.modules.inflowcore.android.SqlItemStore
import expo.modules.inflowcore.android.SqlLedgerStore
import expo.modules.inflowcore.android.StoreHolder
import expo.modules.inflowcore.core.AiModels
import expo.modules.inflowcore.core.AppSetting
import expo.modules.inflowcore.core.GmailPolicy
import expo.modules.inflowcore.core.Prices
import expo.modules.inflowcore.core.Retention
import kotlinx.coroutines.Dispatchers
import java.io.File
import kotlinx.coroutines.withContext

private const val CAPTURED_EVENT = "onCaptured"
private const val MEDIA_AUTHORITY = "com.haroon.inflow.media"
private const val MAX_INLINE_BYTES = 8L * 1024 * 1024
private val ADDRESS_QUERY = Regex("[^@\\s]*@[^@\\s.]+\\.[^@\\s]+")

class InflowCoreModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  private fun store(): SqlItemStore =
    StoreHolder.get(context).getOrElse { throw CodedException("STORE_UNAVAILABLE", it.message, it) }

  private fun open(intent: Intent) {
    context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  private fun settingFor(store: SqlItemStore, pkg: String): AppSetting = store.appSetting(pkg) ?: Retention.default(pkg, InflowListener.label(context, pkg))

  override fun definition() = ModuleDefinition {
    Name("InflowCore")

    Events(CAPTURED_EVENT)

    OnCreate {
      StoreHolder.onCaptured = { count -> sendEvent(CAPTURED_EVENT, mapOf("count" to count)) }
      // Decrypted copies handed to a viewer live only until the next start; files no row names are swept (rolled-back saves).
      InflowListener.executor.execute {
        runCatching {
          File(context.cacheDir, "open").deleteRecursively()
          StoreHolder.get(context).getOrNull()?.let { MediaStore.sweep(File(context.filesDir, "media"), it.mediaFiles()) }
        }
      }
    }

    OnDestroy {
      StoreHolder.onCaptured = null
    }

    Function("getStatus") { ->
      val ctx = context
      val holder = StoreHolder.get(ctx)
      mapOf(
        "accessGranted" to NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName),
        "listenerConnected" to InflowListener.connected.get(),
        "lastCaptureAt" to holder.getOrNull()?.meta(InflowListener.LAST_CAPTURE_AT)?.toLongOrNull(),
        "batteryUnrestricted" to (ctx.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(ctx.packageName) ?: false),
        "storeError" to holder.exceptionOrNull()?.message,
        "smsGranted" to SmsImporter.granted(ctx),
      )
    }

    Function("openNotificationAccess") { ->
      open(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    Function("openAppInfo") { ->
      open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)))
    }

    Function("openBatterySettings") { ->
      open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }

    Function("reconnect") { ->
      InflowListener.rebind(context)
    }

    AsyncFunction("authenticate") Coroutine { ->
      val activity = appContext.currentActivity as? FragmentActivity
      val (ok, message) = if (activity == null) false to Lock.FAILED else Lock.authenticate(activity)
      mapOf("ok" to ok, "message" to message)
    }

    Function("home") { startOfDay: Long ->
      val store = store()
      StoreHolder.ingest(context, store).housekeeping()
      AiRunner.runIfDue(context)   // in the background: Home never waits for the model
      store.home(startOfDay, System.currentTimeMillis())
    }

    Function("listItems") { filter: Map<String, Any?>, before: Long?, limit: Int, beforeId: Long? ->
      store().list(filter, before, limit, System.currentTimeMillis(), beforeId)
    }

    Function("listApps") { ->
      store().allAppSettings().map { mapOf("pkg" to it.pkg, "label" to it.label, "record" to it.record, "keepDays" to it.keepDays) }
    }

    AsyncFunction("importSms") { ->
      val imported = SmsImporter.sync(context)
      if (imported > 0) StoreHolder.onCaptured?.invoke(imported)
      mapOf("imported" to imported)
    }

    Function("money") { from: Long, to: Long ->
      SqlLedgerStore(store().db).money(from, to)
    }

    Function("listTxns") { account: String?, before: Long?, limit: Int, beforeId: Long? ->
      SqlLedgerStore(store().db).listTxns(account, before, limit, beforeId)
    }

    Function("setOwnTransfer") { txnId: Long, own: Boolean ->
      val store = store()
      store.inTransaction { StoreHolder.ledger(store).setOwnTransfer(txnId, own) }
    }

    Function("getItem") { id: Long ->
      store().item(id, System.currentTimeMillis())
    }

    Function("mediaFor") { itemId: Long ->
      SqlMediaIndex(store()).forItem(itemId).map { mapOf("id" to it.id, "kind" to it.kind, "mime" to it.mime, "size" to it.size) }
    }

    // Base64 of the decrypted bytes, only for a photo or sticker of at most 8 MB; anything else is opened with openMedia.
    Function("readMedia") { mediaId: Long ->
      val store = store()
      val row = SqlMediaIndex(store).get(mediaId) ?: throw CodedException("MEDIA_MISSING", "That file is no longer saved.", null)
      if (row.kind != "image" && row.kind != "sticker" || row.size > MAX_INLINE_BYTES) throw CodedException("MEDIA_TOO_BIG", "Open this file instead.", null)
      val bytes = StoreHolder.media(context, store)?.read(mediaId) ?: throw CodedException("MEDIA_UNREADABLE", "That file could not be read.", null)
      Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    // Decrypts into cache/open and hands it to a viewer through the not-exported FileProvider; the folder is cleared at the next start.
    Function("openMedia") { mediaId: Long ->
      val store = store()
      val row = SqlMediaIndex(store).get(mediaId) ?: throw CodedException("MEDIA_MISSING", "That file is no longer saved.", null)
      val bytes = StoreHolder.media(context, store)?.read(mediaId) ?: throw CodedException("MEDIA_UNREADABLE", "That file could not be read.", null)
      val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(row.mime) ?: "bin"
      val file = File(File(context.cacheDir, "open").apply { mkdirs() }, "${row.id}.$ext")
      file.writeBytes(bytes)
      val uri = FileProvider.getUriForFile(context, MEDIA_AUTHORITY, file)
      try {
        open(Intent(Intent.ACTION_VIEW).setDataAndType(uri, row.mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
      } catch (e: android.content.ActivityNotFoundException) {
        file.delete()
        throw CodedException("MEDIA_NO_VIEWER", "No app can open this file.", null)
      }
    }

    Function("mediaStats") { ->
      val store = store()
      fun n(key: String) = store.meta(key)?.toLongOrNull() ?: 0L
      mapOf(
        "saved" to n("mediaSaved"), "bytes" to n("mediaBytes"), "unreadable" to n("mediaUnreadable"), "tooBig" to n("mediaTooBig"),
        "lastMime" to store.meta("mediaLastMime")?.takeIf { it.isNotBlank() },
      )
    }

    Function("getOwnerName") { ->
      store().meta(StoreHolder.OWNER_NAME)?.takeIf { it.isNotBlank() }
    }

    Function("setOwnerName") { name: String? ->
      val store = store()
      store.inTransaction {
        val old = store.meta(StoreHolder.OWNER_NAME)?.takeIf { it.isNotBlank() }
        store.setMeta(StoreHolder.OWNER_NAME, name?.trim().orEmpty())
        StoreHolder.ledger(store).ownerNameChanged(old)
      }
    }

    Function("setRecord") { pkg: String, record: Boolean, deleteSaved: Boolean ->
      val store = store()
      store.putAppSetting(settingFor(store, pkg).copy(record = record))
      if (deleteSaved) store.deleteApp(pkg)
    }

    Function("setKeep") { pkg: String, days: Int? ->
      val store = store()
      store.putAppSetting(settingFor(store, pkg).copy(keepDays = days))
    }

    Function("renameSender") { senderKey: String, name: String? ->
      store().rename(senderKey, name)
    }

    Function("listSenderNames") { ->
      store().senderNames()
    }

    // Never returns the password.
    Function("gmailStatus") { ->
      val store = store()
      mapOf(
        "address" to store.meta(GmailSync.ADDRESS)?.takeIf { it.isNotBlank() },
        "lastSyncAt" to store.meta(GmailSync.LAST_SYNC_AT)?.toLongOrNull(),
        "error" to store.meta(GmailSync.ERROR)?.takeIf { it.isNotBlank() },
        "senders" to store.gmailSenders().map { it.query },
      )
    }

    // Tests the sign-in first, saves only on success. The network work runs on Dispatchers.IO so it never holds
    // Expo's shared AsyncFunction queue (authenticate and importSms share it). The first sync is the caller's: syncGmail.
    AsyncFunction("connectGmail") Coroutine { address: String, appPassword: String ->
      val mail = address.trim()
      val password = GmailClient.clean(appPassword)
      val invalid = when {
        !mail.contains('@') -> GmailSync.ADDRESS_ERROR
        password.length != 16 || !password.all { it.isLetter() } -> GmailSync.PASSWORD_ERROR
        else -> null
      }
      val failure = invalid ?: withContext(Dispatchers.IO) {
        try {
          GmailClient.check(mail, password)
          null
        } catch (e: Exception) {
          GmailPolicy.errorCopy(e)
        }
      }
      if (failure == null) {
        val store = store()
        store.inTransaction {
          store.setMeta(GmailSync.ADDRESS, mail)
          store.setMeta(GmailSync.PASSWORD, password)
          store.deleteMeta(GmailSync.ERROR)
          if (store.gmailSenders().isEmpty()) GmailSync.DEFAULT_SENDERS.forEach(store::addGmailSender)
        }
      }
      mapOf("ok" to (failure == null), "message" to failure)
    }

    // Forgets the sign-in; marked senders and saved emails stay.
    Function("disconnectGmail") { ->
      val store = store()
      store.inTransaction {
        listOf(GmailSync.ADDRESS, GmailSync.PASSWORD, GmailSync.ERROR, GmailSync.LAST_SYNC_AT).forEach(store::deleteMeta)
        store.resetGmailCursors()
      }
    }

    Function("addGmailSender") { query: String ->
      // A query with '@' must be "@domain.tld" or "local@domain.tld"; anything else could never match and would eat the cursor.
      query.trim().lowercase().takeIf { it.isNotEmpty() && ('@' !in it || ADDRESS_QUERY.matches(it)) }?.let(store()::addGmailSender)
    }

    Function("removeGmailSender") { query: String ->
      store().removeGmailSender(query.trim().lowercase())
    }

    AsyncFunction("syncGmail") Coroutine { ->
      val imported = withContext(Dispatchers.IO) { GmailSync.sync(context) }
      if (imported > 0) StoreHolder.onCaptured?.invoke(imported)
      mapOf("imported" to imported)
    }

    Function("aiStatus") { ->
      AiConfig(store()).status()
    }

    Function("knownModels") { ->
      AiModels.KNOWN.map { mapOf("name" to it.name, "baseUrl" to it.baseUrl, "model" to it.model) }
    }

    // `prices` is null for a model Inflow knows. Returns the validation copy, or null once saved (a thrown message would reach JS wrapped by Expo).
    Function("setAiModel") { baseUrl: String, model: String, prices: Map<String, Any?>? ->
      val custom = prices?.let { Prices(price(it, "inputPerM"), price(it, "cachedPerM"), price(it, "outputPerM")) }
      AiModels.validate(baseUrl, model, custom) ?: run {
        AiConfig(store()).setModel(baseUrl, model, custom)
        null
      }
    }

    // Returns the error copy, or null once the key is saved. It is never returned to JS again except its last four characters.
    Function("addAiKey") { apiKey: String ->
      val key = apiKey.trim()
      when {
        key.isEmpty() -> "Paste your API key first."
        key.length > 300 || key.any(Char::isWhitespace) -> "That doesn't look like an API key. Copy it again, without spaces."
        else -> {
          AiConfig(store()).addKey(key)
          null
        }
      }
    }

    Function("removeAiKey") { id: Long ->
      AiConfig(store()).removeKey(id)
    }

    AsyncFunction("testAiKey") Coroutine { id: Long ->
      withContext(Dispatchers.IO) { AiRunner.test(context, id) }
    }

    // Returns the error copy, or null once saved.
    Function("setAiCap") { usd: Double? ->
      if (usd != null && !(usd.isFinite() && usd in 0.01..100.0)) "The daily limit must be a number from 0.01 to 100."
      else {
        AiConfig(store()).setCap(usd)
        null
      }
    }

    AsyncFunction("sendAiNow") Coroutine { ->
      val r = withContext(Dispatchers.IO) { AiRunner.runNow(context) }
      mapOf("sent" to r.sent, "saved" to r.saved, "stoppedByCap" to r.stoppedByCap, "error" to r.error)
    }

    Function("setAiBlocked") { blockKey: String, blocked: Boolean ->
      if (blockKey.startsWith("app:") || blockKey.startsWith("sender:")) AiConfig(store()).setBlocked(blockKey, blocked)
    }

    Function("listAiBlocks") { ->
      AiConfig(store()).blocks()
    }

    Function("setTodoDone") { id: Long, done: Boolean ->
      store().setTodoDone(id, done)
    }

    AsyncFunction("ask") Coroutine { question: String ->
      withContext(Dispatchers.IO) { AiRunner.ask(context, question) }
    }
  }
}

private fun price(m: Map<String, Any?>, key: String): Double = (m[key] as? Number)?.toDouble() ?: Double.NaN
