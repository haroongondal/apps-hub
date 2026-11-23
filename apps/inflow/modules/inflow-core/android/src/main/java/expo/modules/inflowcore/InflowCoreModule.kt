package expo.modules.inflowcore

import android.Manifest
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
import expo.modules.kotlin.Promise
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.inflowcore.android.AiConfig
import expo.modules.inflowcore.android.AiRunner
import expo.modules.inflowcore.android.BriefingRefresh
import expo.modules.inflowcore.android.DigestAlarm
import expo.modules.inflowcore.android.Lock
import expo.modules.inflowcore.android.GmailClient
import expo.modules.inflowcore.android.Gallery
import expo.modules.inflowcore.android.GmailSync
import expo.modules.inflowcore.android.DoctorPdf
import expo.modules.inflowcore.android.DoctorRunner
import expo.modules.inflowcore.android.HealthConnectReader
import expo.modules.inflowcore.android.InflowListener
import expo.modules.inflowcore.android.MediaStore
import expo.modules.inflowcore.android.MedicineReminders
import expo.modules.inflowcore.android.ReportNotifier
import expo.modules.inflowcore.android.SqlHealthStore
import expo.modules.inflowcore.android.SqlReportStore
import expo.modules.inflowcore.android.SqlMediaIndex
import expo.modules.inflowcore.android.SmsImporter
import expo.modules.inflowcore.android.SqlItemStore
import expo.modules.inflowcore.android.SqlJournalStore
import expo.modules.inflowcore.android.SqlMedicineStore
import expo.modules.inflowcore.android.SqlLedgerStore
import expo.modules.inflowcore.android.SqlSuggestionStore
import expo.modules.inflowcore.android.SuggestionNotifier
import expo.modules.inflowcore.android.StoreHolder
import expo.modules.inflowcore.core.AiBatch
import expo.modules.inflowcore.core.AiChannels
import expo.modules.inflowcore.core.AiModels
import expo.modules.inflowcore.core.AppSetting
import expo.modules.inflowcore.core.AUTOPILOT_META
import expo.modules.inflowcore.core.AutopilotSettings
import expo.modules.inflowcore.core.AutopilotSettingsInput
import expo.modules.inflowcore.core.Briefing
import expo.modules.inflowcore.core.Categories
import expo.modules.inflowcore.core.Digest
import expo.modules.inflowcore.core.NexusShares
import expo.modules.inflowcore.core.DoctorPayload
import expo.modules.inflowcore.core.DoctorRange
import expo.modules.inflowcore.core.Edits
import expo.modules.inflowcore.core.HealthForAsk
import expo.modules.inflowcore.core.GmailPolicy
import expo.modules.inflowcore.core.HealthAggregate
import expo.modules.inflowcore.core.Journal
import expo.modules.inflowcore.core.Medicines
import expo.modules.inflowcore.core.Prices
import expo.modules.inflowcore.core.RawMedia
import expo.modules.inflowcore.core.Retention
import expo.modules.inflowcore.core.SuggestionMoves
import expo.modules.inflowcore.core.SuggestionState
import expo.modules.inflowcore.core.toMap
import expo.modules.inflowcore.core.toRow
import kotlinx.coroutines.Dispatchers
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeParseException
import kotlinx.coroutines.withContext

private const val CAPTURED_EVENT = "onCaptured"
private const val SUGGESTIONS_EVENT = "onSuggestions"
private const val MEDIA_AUTHORITY = "com.haroon.inflow.media"
private const val MAX_INLINE_BYTES = 8L * 1024 * 1024
private const val MAX_RECEIPT_BYTES = 20L * 1024 * 1024
private const val OPEN_GRACE_MS = 30_000L
private val ADDRESS_QUERY = Regex("[^@\\s]*@[^@\\s.]+\\.[^@\\s]+")

class InflowCoreModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  private fun store(): SqlItemStore =
    StoreHolder.get(context).getOrElse { throw CodedException("STORE_UNAVAILABLE", it.message, it) }

  private fun clearOpened(olderThanMs: Long = 0L) = MediaStore.clearOpened(File(context.cacheDir, "open"), olderThanMs)

  private fun open(intent: Intent) {
    context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  /** The report a tapped notification asked for, until JS takes it. The extra is removed so a second read cannot repeat it. */
  @Volatile private var openReport: Long? = null

  private fun readOpenReport(intent: Intent?) {
    if (intent == null || !intent.hasExtra(ReportNotifier.EXTRA)) return
    val id = intent.getLongExtra(ReportNotifier.EXTRA, -1L)
    intent.removeExtra(ReportNotifier.EXTRA)
    if (id >= 0) openReport = id
  }

  private lateinit var healthPermissions: AppContextActivityResultLauncher<ArrayList<String>, Set<String>>
  private lateinit var createPdf: AppContextActivityResultLauncher<String, Uri?>

  private fun day(text: String): String =
    try {
      LocalDate.parse(text).toString()
    } catch (e: DateTimeParseException) {
      throw CodedException("BAD_DAY", "Use a date like 2026-03-10.", null)
    }

  private fun settingFor(store: SqlItemStore, pkg: String): AppSetting = store.appSetting(pkg) ?: Retention.default(pkg, InflowListener.label(context, pkg))

  /** Tells JS the list may have changed, with the number of waiting suggestions (expired ones are swept first). */
  private fun sendSuggestions() {
    val waiting = runCatching { StoreHolder.get(context).getOrNull()?.let { SqlSuggestionStore(it.db).apply { expire(System.currentTimeMillis()) }.waiting().size } }.getOrNull() ?: 0
    sendEvent(SUGGESTIONS_EVENT, mapOf("count" to waiting))
  }

  override fun definition() = ModuleDefinition {
    Name("InflowCore")

    Events(CAPTURED_EVENT, SUGGESTIONS_EVENT)

    OnCreate {
      StoreHolder.onCaptured = { count ->
        sendEvent(CAPTURED_EVENT, mapOf("count" to count))
        sendSuggestions()
      }
      StoreHolder.backfill(context)
      StoreHolder.heartbeat(context)
      MedicineReminders.rearm(context)
      // Decrypted copies handed to a viewer live only until the next start; files no row names are swept (rolled-back saves).
      InflowListener.executor.execute {
        runCatching {
          clearOpened()
          StoreHolder.get(context).getOrNull()?.let { MediaStore.sweep(File(context.filesDir, "media"), it.mediaFiles()) }
        }
      }
    }

    OnNewIntent { intent -> readOpenReport(intent) }

    RegisterActivityContracts {
      healthPermissions = registerForActivityResult(HealthConnectReader.PermissionContract())
      createPdf = registerForActivityResult(DoctorPdf.CreateContract())
    }

    OnDestroy {
      StoreHolder.onCaptured = null
      runCatching { clearOpened() }
    }

    OnActivityEntersForeground {
      StoreHolder.heartbeat(context)
    }

    // The app locks when it goes to the background, so the decrypted copies go too; a copy younger than the grace stays
    // because that move may be the hand-over to the viewer that has not opened it yet (it goes at the next background or start).
    OnActivityEntersBackground {
      runCatching { clearOpened(OPEN_GRACE_MS) }
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
      store.home(startOfDay, System.currentTimeMillis(), StoreHolder.smsPackages(context))
    }

    Function("listItems") { filter: Map<String, Any?>, before: Long?, limit: Int, beforeId: Long? ->
      store().list(filter, before, limit, System.currentTimeMillis(), beforeId)
    }

    Function("apps") { startOfDay: Long ->
      store().apps(startOfDay, System.currentTimeMillis(), StoreHolder.smsPackages(context))
    }

    Function("contacts") { pkg: String, startOfDay: Long, before: Long?, beforeKey: String?, limit: Int, promo: Boolean ->
      store().contacts(pkg, startOfDay, System.currentTimeMillis(), before, beforeKey, limit, promo)
    }

    Function("promotions") { pkg: String ->
      store().promotions(pkg, System.currentTimeMillis())
    }

    Function("smsPromotion") { itemId: Long ->
      store().smsPromotion(itemId)
    }

    Function("setPromotion") { key: String, promotional: Boolean ->
      store().setPromotion(key, promotional)
    }

    Function("listApps") { ->
      val sms = StoreHolder.smsPackages(context)   // the default SMS app is eligible too
      store().allAppSettings().map { mapOf("pkg" to it.pkg, "label" to it.label, "record" to it.record, "keepDays" to it.keepDays, "aiEligible" to (it.pkg in sms + AiChannels.PKGS)) }
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

    Function("partyTotals") { name: String?, own: Boolean ->
      SqlLedgerStore(store().db).partyTotals(name, own)
    }

    Function("listPartyTxns") { name: String?, own: Boolean, before: Long?, limit: Int, beforeId: Long? ->
      SqlLedgerStore(store().db).listPartyTxns(name, own, before, limit, beforeId)
    }

    Function("setOwnTransfer") { txnId: Long, own: Boolean ->
      val store = store()
      store.inTransaction { StoreHolder.ledger(store).setOwnTransfer(txnId, own) }
    }

    Function("categories") { ->
      mapOf("out" to Categories.OUT, "in" to Categories.IN)
    }

    // null = back to the AI's choice. A name that is not in the txn's direction list is refused, never stored.
    Function("setCategory") { txnId: Long, category: String? ->
      val ledger = SqlLedgerStore(store().db)
      val txn = ledger.get(txnId) ?: throw CodedException("TXN_MISSING", "That transaction is gone.", null)
      if (category != null && category !in Categories.forDirection(txn.direction)) throw CodedException("BAD_CATEGORY", "That category doesn't fit this transaction.", null)
      ledger.setCategory(txnId, category)
    }

    Function("listReports") { ->
      SqlReportStore(store().db).list().map { SqlReportStore.row(it) }
    }

    // `data` is the stored report as a Map/List tree (amounts in minor units), null when the row has none.
    Function("getReport") { id: Long ->
      val reports = SqlReportStore(store().db)
      reports.get(id)?.let { mapOf("row" to SqlReportStore.row(it), "data" to reports.data(id)) }
    }

    AsyncFunction("makeReportNow") Coroutine { ->
      val (ok, message) = withContext(Dispatchers.IO) { AiRunner.makeReportNow(context) }
      mapOf("ok" to ok, "message" to message)
    }

    AsyncFunction("retryReport") Coroutine { id: Long ->
      val (ok, message) = withContext(Dispatchers.IO) { AiRunner.retryReport(context, id) }
      mapOf("ok" to ok, "message" to message)
    }

    Function("notificationsAllowed") { ->
      ReportNotifier.allowed(context)
    }

    // Shows the system prompt once; resolves with whether notifications are allowed afterwards.
    AsyncFunction("askNotifications") { promise: Promise ->
      val permissions = appContext.permissions
      if (permissions == null) promise.resolve(false)
      else permissions.askForPermissions({ _ -> promise.resolve(ReportNotifier.allowed(context)) }, Manifest.permission.POST_NOTIFICATIONS)
    }

    // The id from a tapped notification (cold start or already running), once.
    Function("takeOpenReport") { ->
      readOpenReport(appContext.currentActivity?.intent)
      openReport.also { openReport = null }
    }

    // The owner's edit of a transaction's clean name (blank clears it); the category is set with setCategory. Returns null once saved.
    Function("setTxnLabel") { txnId: Long, label: String? ->
      val store = store()
      val found = store.inTransaction { StoreHolder.ledger(store).editLabel(txnId, Edits.label(label)) }
      if (found) null else "That transaction is no longer saved."
    }

    // Removes the transaction and its source links; the messages it came from stay, and are not read into a transaction again.
    Function("deleteTxn") { txnId: Long ->
      val store = store()
      store.inTransaction { StoreHolder.ledger(store).deleteByOwner(txnId) }
    }

    Function("getItem") { id: Long ->
      store().item(id, System.currentTimeMillis())
    }

    // The owner deleted a saved message: it, its AI result, to-dos and media go, and a re-import does not bring it back. False when it was already gone.
    Function("deleteItem") { id: Long ->
      store().deleteItem(id)
    }

    // Every saved message of one conversation (a key from ConversationRow or Item.conversationKey). Returns how many were deleted.
    Function("deleteConversation") { key: String ->
      store().deleteConversation(key)
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

    // Decrypts into cache/open and hands it to a viewer through the not-exported FileProvider; the folder is cleared at the next start, when the app goes to the background and when it closes (a deleted item takes its copy with it).
    Function("openMedia") { mediaId: Long ->
      val store = store()
      val row = SqlMediaIndex(store).get(mediaId) ?: throw CodedException("MEDIA_MISSING", "That file is no longer saved.", null)
      val bytes = StoreHolder.media(context, store)?.read(mediaId) ?: throw CodedException("MEDIA_UNREADABLE", "That file could not be read.", null)
      val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(row.mime) ?: "bin"
      val file = File(File(context.cacheDir, "open").apply { mkdirs() }, "${row.file}.$ext")
      file.writeBytes(bytes)
      val uri = FileProvider.getUriForFile(context, MEDIA_AUTHORITY, file)
      try {
        open(Intent(Intent.ACTION_VIEW).setDataAndType(uri, row.mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
      } catch (e: android.content.ActivityNotFoundException) {
        file.delete()
        throw CodedException("MEDIA_NO_VIEWER", "No app can open this file.", null)
      }
    }

    Function("galleryBetween") { fromMs: Long, toMs: Long ->
      if (!Gallery.granted(context)) throw CodedException("GALLERY_DENIED", "Allow photos to search for receipts.", null)
      Gallery.between(context, fromMs, toMs)
    }

    Function("attachReceipt") { itemId: Long, uri: String ->
      val store = store()
      val photos = android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI.toString()
      if (!uri.startsWith(photos)) throw CodedException("RECEIPT_NOT_PHOTO", "Pick a photo from the gallery.", null)
      val source = Uri.parse(uri)
      val size = context.contentResolver.openAssetFileDescriptor(source, "r")?.use { it.length } ?: -1L
      if (size > MAX_RECEIPT_BYTES) throw CodedException("MEDIA_TOO_BIG", "That photo is over 20 MB.", null)
      val bytes = context.contentResolver.openInputStream(source)?.use { it.readBytes() }
        ?: throw CodedException("RECEIPT_UNREADABLE", "That photo could not be read.", null)
      if (bytes.size > MAX_RECEIPT_BYTES) throw CodedException("MEDIA_TOO_BIG", "That photo is over 20 MB.", null)
      val mime = context.contentResolver.getType(source) ?: "image/jpeg"
      val media = StoreHolder.media(context, store) ?: throw CodedException("MEDIA_UNAVAILABLE", "Receipts can't be saved right now.", null)
      if (!media.save(itemId, RawMedia(mime, bytes), System.currentTimeMillis())) {
        throw CodedException("RECEIPT_NOT_SAVED", "This photo is already saved for this transaction.", null)
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

    // To-dos: the AI's (itemId of the message) and the owner's own (itemId 0). Done ones last when includeDone.
    Function("listTodos") { includeDone: Boolean ->
      store().listTodos(includeDone, System.currentTimeMillis())
    }

    // Each returns the error copy, or null once saved.
    Function("addTodo") { text: String, dueAt: Long? ->
      val clean = Edits.todoText(text)
      if (clean == null) "Write what needs doing first."
      else {
        store().addTodo(clean, dueAt)
        null
      }
    }

    Function("updateTodo") { id: Long, text: String, dueAt: Long? ->
      val clean = Edits.todoText(text)
      if (clean == null) "Write what needs doing first."
      else {
        store().updateTodo(id, clean, dueAt)
        null
      }
    }

    Function("deleteTodo") { id: Long ->
      store().deleteTodo(id)
    }

    // The suggestions in these states (SuggestionRow keys, lowercase kind and state), newest first. Expired ones are swept first.
    Function("suggestions") { states: List<String>, limit: Int ->
      val wanted = states.mapNotNull { n -> SuggestionState.values().firstOrNull { it.name.equals(n, ignoreCase = true) } }.toSet()
      val suggestions = SqlSuggestionStore(store().db)
      suggestions.expire(System.currentTimeMillis())
      suggestions.list(wanted, limit.coerceIn(0, 200)).map { it.toRow() }
    }

    // The owner's Run: returns what to tell them, or null once it started.
    Function("runSuggestion") { id: Long ->
      SuggestionNotifier.run(context, id).also { sendSuggestions() }
    }

    Function("skipSuggestion") { id: Long ->
      SuggestionMoves.move(SqlSuggestionStore(store().db), id, SuggestionState.SKIPPED, System.currentTimeMillis())
      SuggestionNotifier.cancel(context, id)
      sendSuggestions()
    }

    Function("autopilotSettings") { ->
      AutopilotSettings.fromJson(store().meta(AUTOPILOT_META)).toMap()
    }

    Function("setAutopilotSettings") { settings: Map<String, Any?> ->
      store().setMeta(AUTOPILOT_META, AutopilotSettingsInput.fromMap(settings).toJson())
    }

    // Chats the owner may pick (not SMS or email, which already reach the AI); id is "pkg|conversationKey".
    Function("pickableChats") { ->
      store().pickableChats()
    }

    AsyncFunction("ask") Coroutine { question: String ->
      withContext(Dispatchers.IO) { AiRunner.ask(context, question) }
    }

    AsyncFunction("healthStatus") Coroutine { ->
      withContext(Dispatchers.IO) { HealthConnectReader.status(context) }
    }

    // Health Connect's own screen; resolves with whether all three are granted afterwards (false at once when Health Connect is not ready).
    AsyncFunction("requestHealthPermissions") Coroutine { ->
      if (HealthConnectReader.availability(context) != "available") return@Coroutine false
      healthPermissions.launch(ArrayList(HealthConnectReader.PERMISSIONS))
      withContext(Dispatchers.IO) { HealthConnectReader.granted(context) } == HealthConnectReader.PERMISSIONS
    }

    // Reads the last `days` local days (1 to 90) and replaces them in the store; only called while the app is open.
    AsyncFunction("refreshHealth") Coroutine { days: Int ->
      withContext(Dispatchers.IO) { HealthConnectReader.refresh(context, store(), days.coerceIn(1, HealthAggregate.MAX_DAYS)) }
    }

    Function("healthDays") { fromDay: String, toDay: String ->
      SqlHealthStore(store().db).days(day(fromDay), day(toDay)).map { it.toMap() }
    }

    // Stopped medicines last; they keep their history.
    Function("medicines") { ->
      SqlMedicineStore(store()).medicines().map { it.toMap() }
    }

    // Create (id null) or update; returns the problem in plain words, or null once saved. Saving works without the notification permission.
    Function("saveMedicine") { m: Map<String, Any?> ->
      val s = store()
      s.inTransaction { Medicines.save(SqlMedicineStore(s), m, System.currentTimeMillis()) }.also { if (it == null) MedicineReminders.rearm(context) }
    }

    Function("stopMedicine") { id: Long ->
      SqlMedicineStore(store()).stop(id)
      MedicineReminders.cancelAll(context, id)
      MedicineReminders.rearm(context)
    }

    // The medicine and its whole dose history, in one transaction.
    Function("deleteMedicine") { id: Long ->
      SqlMedicineStore(store()).delete(id)
      MedicineReminders.cancelAll(context, id)
      MedicineReminders.rearm(context)
    }

    Function("dosesBetween") { fromDay: String, toDay: String ->
      val from = LocalDate.parse(day(fromDay))
      val to = LocalDate.parse(day(toDay))
      if (to.isBefore(from) || to.isAfter(from.plusDays(366))) throw CodedException("BAD_RANGE", "Pick a range of at most a year, ending on or after its start.", null)
      Medicines.dosesBetween(SqlMedicineStore(store()), from, to, System.currentTimeMillis(), ZoneId.systemDefault()).map { it.toMap() }
    }

    // Taken or skipped, also later as a correction; returns the problem in plain words, or null once saved.
    Function("markDose") { medicineId: Long, dueAt: Long, status: String ->
      val s = store()
      s.inTransaction { Medicines.markFromApp(SqlMedicineStore(s), medicineId, dueAt, status, System.currentTimeMillis(), ZoneId.systemDefault()) }.also {
        if (it == null) {
          MedicineReminders.cancel(context, medicineId, dueAt)
          MedicineReminders.rearm(context)
        }
      }
    }

    Function("adherence") { period: String ->
      if (period != "week" && period != "month") throw CodedException("BAD_PERIOD", "Pick week or month.", null)
      Medicines.adherence(SqlMedicineStore(store()), period, System.currentTimeMillis(), ZoneId.systemDefault()).toMap()
    }

    // False when notifications or the medicine reminders channel are off: medicines still save, reminders cannot show. askNotifications asks.
    Function("medicineRemindersAllowed") { ->
      MedicineReminders.allowed(context)
    }

    Function("journalList") { beforeAt: Long?, limit: Int ->
      Journal.list(SqlJournalStore(store()), beforeAt, limit).map { it.toMap() }
    }

    Function("saveJournal") { entry: Map<String, Any?> ->
      Journal.save(SqlJournalStore(store()), entry, System.currentTimeMillis())
    }

    Function("deleteJournal") { id: Long ->
      SqlJournalStore(store()).delete(id)
    }

    AsyncFunction("doctorPreview") Coroutine { fromDay: String, toDay: String, include: Map<String, Any?> ->
      withContext(Dispatchers.IO) { DoctorRunner.of(store()).preview(fromDay, toDay, include) }
    }

    // Only on the owner's tap after the preview; refuses when the data no longer hashes to what they saw.
    AsyncFunction("doctorSummarize") Coroutine { fromDay: String, toDay: String, include: Map<String, Any?>, hash: String ->
      withContext(Dispatchers.IO) { DoctorRunner.of(store()).summarize(fromDay, toDay, include, hash) }
    }

    // True once saved, false when the owner closed the file picker.
    AsyncFunction("saveDoctorPdf") Coroutine { summary: String, fromDay: String, toDay: String ->
      val range = DoctorRange.parse(fromDay, toDay).getOrElse { throw CodedException("BAD_RANGE", it.message, null) }
      val text = DoctorPayload.cleanReply(summary)
      if (text.isEmpty()) throw CodedException("NO_SUMMARY", "Make the summary first.", null)
      val uri = createPdf.launch(DoctorPdf.fileName(range)) ?: return@Coroutine false
      if (!withContext(Dispatchers.IO) { DoctorPdf.save(context, uri, text, range) }) {
        throw CodedException("PDF_FAILED", "Inflow couldn't save the PDF. Try again, or pick another folder.", null)
      }
      true
    }

    Function("healthInAsk") { ->
      HealthForAsk.on(store().meta(HealthForAsk.META))
    }

    Function("setHealthInAsk") { on: Boolean ->
      if (on) store().setMeta(HealthForAsk.META, "1") else store().deleteMeta(HealthForAsk.META)
    }

    Function("healthInBriefing") { ->
      Briefing.on(store().meta(Briefing.HEALTH_META))
    }

    Function("setHealthInBriefing") { on: Boolean ->
      if (on) store().setMeta(Briefing.HEALTH_META, "1") else store().deleteMeta(Briefing.HEALTH_META)
      BriefingRefresh.settingChanged(context)
    }

    Function("briefingShare") { ->
      Briefing.on(store().meta(Briefing.SHARE_META))
    }

    Function("setBriefingShare") { on: Boolean ->
      if (on) store().setMeta(Briefing.SHARE_META, "1") else store().deleteMeta(Briefing.SHARE_META)
      BriefingRefresh.settingChanged(context)
    }

    Function("digest") { ->
      Briefing.on(store().meta(Digest.META))
    }

    Function("setDigest") { on: Boolean ->
      if (on) store().setMeta(Digest.META, "1") else store().deleteMeta(Digest.META)
      DigestAlarm.rearm(context)
    }

    Function("nexusAsk") { ->
      Briefing.on(store().meta(NexusShares.ASK_META))
    }

    Function("setNexusAsk") { on: Boolean ->
      if (on) store().setMeta(NexusShares.ASK_META, "1") else store().deleteMeta(NexusShares.ASK_META)
    }

    Function("nexusDebits") { ->
      Briefing.on(store().meta(NexusShares.DEBITS_META))
    }

    Function("setNexusDebits") { on: Boolean ->
      if (on) store().setMeta(NexusShares.DEBITS_META, "1") else store().deleteMeta(NexusShares.DEBITS_META)
    }
  }
}

private fun price(m: Map<String, Any?>, key: String): Double = (m[key] as? Number)?.toDouble() ?: Double.NaN
