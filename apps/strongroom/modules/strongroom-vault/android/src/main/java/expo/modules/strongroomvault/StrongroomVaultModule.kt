package expo.modules.strongroomvault

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.nfc.NfcAdapter
import android.nfc.cardemulation.CardEmulation
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.provider.Settings
import android.view.autofill.AutofillManager
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.strongroomvault.android.BiometricKey
import expo.modules.strongroomvault.android.EntryInput
import expo.modules.strongroomvault.android.AppHealth
import expo.modules.strongroomvault.android.ExpiryShare
import expo.modules.strongroomvault.android.KeepAliveService
import expo.modules.strongroomvault.android.MODE_MIGRATION
import expo.modules.strongroomvault.android.MODE_TOTP
import expo.modules.strongroomvault.android.SCAN_MODE
import expo.modules.strongroomvault.android.SCAN_TOTP_EXTRA
import expo.modules.strongroomvault.android.ScanActivity
import expo.modules.strongroomvault.android.PassImage
import expo.modules.strongroomvault.android.Presenting
import expo.modules.strongroomvault.android.SecretFieldView
import expo.modules.strongroomvault.android.SensitiveClipboard
import expo.modules.strongroomvault.android.SyncJobService
import expo.modules.strongroomvault.android.VaultHolder
import expo.modules.strongroomvault.core.AccountKey
import expo.modules.strongroomvault.core.AccountKeyRequired
import expo.modules.strongroomvault.core.AppId
import expo.modules.strongroomvault.core.Barcode
import expo.modules.strongroomvault.core.BarcodeResult
import expo.modules.strongroomvault.core.Browsers
import expo.modules.strongroomvault.core.CommonPasswords
import expo.modules.strongroomvault.core.CsvExport
import expo.modules.strongroomvault.core.Entry
import expo.modules.strongroomvault.core.GoogleImport
import expo.modules.strongroomvault.core.HealthReport
import expo.modules.strongroomvault.core.HEADER_CHECK
import expo.modules.strongroomvault.core.KEY_LOST
import expo.modules.strongroomvault.core.ImportError
import expo.modules.strongroomvault.core.ImportResult
import expo.modules.strongroomvault.core.KdfOutOfRange
import expo.modules.strongroomvault.core.MigrationImport
import expo.modules.strongroomvault.core.Otp
import expo.modules.strongroomvault.core.PasswordHealth
import expo.modules.strongroomvault.core.LostState
import expo.modules.strongroomvault.core.RecoveryKey
import expo.modules.strongroomvault.core.SmsCodes
import expo.modules.strongroomvault.core.SyncAuthError
import expo.modules.strongroomvault.core.SyncHttpError
import expo.modules.strongroomvault.core.SyncOfflineError
import expo.modules.strongroomvault.core.SyncRollbackError
import expo.modules.strongroomvault.core.SyncStatus
import expo.modules.strongroomvault.core.Type4Tag
import expo.modules.strongroomvault.core.Vault
import java.io.IOException
import java.security.MessageDigest
import java.time.LocalDate
import kotlin.coroutines.resume
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject

private const val LOCK_EVENT = "onLock"
private const val SYNC_EVENT = "onSync"
private const val PICK_CSV = 7401
private const val SAVE_CSV = 7402
private const val SCAN_QR = 7403
private const val MAX_PASS_PX = 2048
private const val MAX_CSV_BYTES = 5 * 1024 * 1024
internal const val KDF_REFUSED =
  "Strongroom won't open this vault: its security settings are weaker than it allows. The vault file may have been changed."
internal const val ACCOUNT_KEY_GONE =
  "This phone no longer holds your account key, so your master password can't open the vault on its own. Sign in to sync with your master password and account key."

class StrongroomVaultModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  private var pendingPick: CancellableContinuation<Uri?>? = null
  private var pendingScan: CancellableContinuation<String?>? = null
  private val main = Handler(Looper.getMainLooper())
  private val autoStop = Runnable { stopPresenting() }

  // Disarms the tag and hands the NFC route back; safe to call when nothing is presenting.
  private fun stopPresenting() {
    main.removeCallbacks(autoStop)
    Presenting.disarm()
    val a = appContext.currentActivity ?: return
    a.runOnUiThread { runCatching { nfcCardEmulation()?.unsetPreferredService(a) } }
  }

  private fun restoreBrightness() {
    appContext.currentActivity?.let { a -> a.runOnUiThread { a.window.attributes = a.window.attributes.apply { screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE } } }
  }

  private fun nfcCardEmulation(): CardEmulation? =
    NfcAdapter.getDefaultAdapter(context)?.let { CardEmulation.getInstance(it) }

  // Vault.touch() runs the expiry check before it refreshes, so a session that has run out is locked, not revived.
  private fun vault(): Vault = VaultHolder.get(context).also { VaultHolder.touch() }

  private fun activity(): FragmentActivity =
    appContext.currentActivity as? FragmentActivity ?: throw CodedException("NO_ACTIVITY", "Open Strongroom and try again.", null)

  override fun definition() = ModuleDefinition {
    Name("StrongroomVault")

    Events(LOCK_EVENT, SYNC_EVENT)

    OnCreate {
      appContext.reactContext?.let { AppHealth.beat(it) }
      VaultHolder.lockListener = {
        stopPresenting()
        sendEvent(LOCK_EVENT)
      }
      VaultHolder.syncListener = { sendEvent(SYNC_EVENT, it.toMap()) }
    }

    OnDestroy {
      VaultHolder.lockListener = null
      VaultHolder.syncListener = null
      // A JS reload destroys the module while a pass may be armed and the screen lit.
      stopPresenting()
      restoreBrightness()
    }

    // Also on a cold start: a killed process can leave a copied secret that no timer or job will clear.
    // A presented pass and a lit-up screen must not outlive the app being on screen.
    OnActivityEntersBackground {
      stopPresenting()
      restoreBrightness()
    }

    OnActivityEntersForeground {
      appContext.reactContext?.let { AppHealth.beat(it) }
      appContext.currentActivity?.let { a -> a.runOnUiThread { SensitiveClipboard.whenFocused(a) } }
    }

    View(SecretFieldView::class) {
      Events("onChangeValue", "onSubmit", "onFocusChange", "onContentHeight")
      Prop("value") { view: SecretFieldView, value: String -> view.value = value }
      Prop("mostRecentEventCount") { view: SecretFieldView, count: Int -> view.jsEventCount = count }
      Prop("shown") { view: SecretFieldView, shown: Boolean -> view.shown = shown }
      Prop("numeric") { view: SecretFieldView, numeric: Boolean -> view.numeric = numeric }
      Prop("multiline") { view: SecretFieldView, multiline: Boolean -> view.multiline = multiline }
      Prop("fontFamily") { view: SecretFieldView, family: String -> view.fontFamily = family }
      Prop("fontSize") { view: SecretFieldView, size: Float -> view.fontSize = size }
      Prop("textInset") { view: SecretFieldView, inset: Float -> view.textInset = inset }
      Prop("textColor") { view: SecretFieldView, color: Color -> view.input.setTextColor(color.toArgb()) }
      Prop("placeholder") { view: SecretFieldView, text: String? -> view.input.hint = text }
      Prop("placeholderColor") { view: SecretFieldView, color: Color -> view.input.setHintTextColor(color.toArgb()) }
      Prop("selectionColor") { view: SecretFieldView, color: Color -> view.setSelectionColor(color.toArgb()) }
      Prop("label") { view: SecretFieldView, label: String -> view.input.contentDescription = label }
      OnViewDidUpdateProps { view: SecretFieldView -> view.update() }
    }

    Function("getStatus") {
      val v = vault()
      mapOf(
        "setUp" to v.isSetUp,
        "unlocked" to v.isUnlocked,
        "biometricEnabled" to VaultHolder.prefs(context).getBoolean(VaultHolder.BIOMETRIC, false),
        "autofillSelected" to (context.getSystemService(AutofillManager::class.java)?.hasEnabledAutofillServices() == true),
        "autoLockMinutes" to v.autoLockMinutes,
        "unreadable" to v.unreadable,
        "lostSaves" to VaultHolder.lostSaves,
        "keepAliveEnabled" to VaultHolder.prefs(context).getBoolean(VaultHolder.KEEP_ALIVE, true),
        "smsFillEnabled" to VaultHolder.prefs(context).getBoolean(VaultHolder.SMS_FILL, false),
        "expiryShare" to ExpiryShare.enabled(context),
        "expiryNames" to ExpiryShare.names(context),
      )
    }

    Function("generateRecoveryKey") {
      vault()
      val key = RecoveryKey.generate()
      try {
        RecoveryKey.format(key)
      } finally {
        key.fill(0)
      }
    }

    AsyncFunction("setUp") Coroutine { password: String, recoveryKey: String ->
      vault()
      val rk = RecoveryKey.parse(recoveryKey) ?: throw CodedException("BAD_RECOVERY_KEY", "That recovery key isn't complete. Check it and try again.", null)
      val pw = password.toCharArray()
      try {
        withContext(Dispatchers.IO) {
          derive { VaultHolder.get(context).setUp(pw, rk) }
          VaultHolder.afterUnlock(context, byPassword = true)
        }
      } finally {
        pw.fill('\u0000')
        rk.fill(0)
      }
    }

    AsyncFunction("unlock") Coroutine { password: String ->
      vault()
      val pw = password.toCharArray()
      try {
        withContext(Dispatchers.IO) { derive { VaultHolder.passwordUnlock(context, pw) } }
      } finally {
        pw.fill('\u0000')
      }
    }

    AsyncFunction("unlockWithBiometric") Coroutine { ->
      vault()
      val activity = appContext.currentActivity as? FragmentActivity
      if (activity == null) {
        false
      } else {
        withContext(Dispatchers.Main) { awaitPrompt { done -> VaultHolder.biometricUnlock(activity, onResult = done) } }
      }
    }

    AsyncFunction("recover") Coroutine { recoveryKey: String, newPassword: String, accountKey: String? ->
      vault()
      val rk = RecoveryKey.parse(recoveryKey)
      val ak = accountKey?.let {
        AccountKey.parse(it) ?: throw CodedException("BAD_ACCOUNT_KEY", "That account key isn't complete. Check it and try again.", null)
      }
      val pw = newPassword.toCharArray()
      try {
        rk != null && withContext(Dispatchers.IO) {
          derive { VaultHolder.sync(context).recoverLocally(rk, pw, ak) }.also {
            if (it) VaultHolder.afterUnlock(context, byPassword = true)
          }
        }
      } finally {
        pw.fill('\u0000')
        rk?.fill(0)
        ak?.fill(0)
      }
    }

    Function("lock") {
      vault().lock()
      VaultHolder.pendingImport = null
    }

    Function("rows") {
      guard { vault().rows().map { mapOf("id" to it.id, "type" to it.type, "name" to it.name, "subtitle" to it.subtitle) } }
    }

    Function("entry") { id: String -> guard { vault().get(id)?.let { view(id, it) } } }

    Function("reveal") { id: String, field: String -> guard { secret(vault(), id, field) } }

    // §15.5: the entry screen's live code and countdown. The code is derived here, never stored.
    Function("totpCode") { id: String ->
      guard { currentTotp(vault(), id).let { mapOf("code" to it.code, "secondsLeft" to it.secondsLeft, "period" to it.period) } }
    }

    Function("copy") { id: String, field: String ->
      guard {
        val value = if (field == "totp") currentTotp(vault(), id).code else secret(vault(), id, field)
        SensitiveClipboard.copy(context, value)
      }
    }

    // Removing a code is not editing the login: the password and everything else stay as they are.
    Function("removeTotp") { id: String ->
      guard {
        val v = vault()
        val login = v.get(id) as? Entry.Login
        if (login != null && login.totp != null) {
          v.put(id, login.copy(totp = null))
          VaultHolder.refreshIndex(context)
        }
      }
    }

    Function("save") { id: String?, input: Map<String, Any?> ->
      guard {
        val v = vault()
        val saved = v.put(id, EntryInput.toEntry(input, id?.let(v::get)))
        VaultHolder.refreshIndex(context)
        saved
      }
    }

    Function("remove") { id: String ->
      guard {
        vault().delete(id)
        VaultHolder.refreshIndex(context)
      }
    }

    AsyncFunction("pickGoogleCsv") Coroutine { ->
      withContext(Dispatchers.IO) { vault() }
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
        .addCategory(Intent.CATEGORY_OPENABLE)
        .setType("text/*")
        .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("text/csv", "text/comma-separated-values"))
      val uri = awaitDocument(intent, PICK_CSV)
      if (uri == null) {
        null
      } else {
        withContext(Dispatchers.IO) {
          val parsed = try {
            readGoogleCsv(uri)
          } catch (e: CodedException) {
            throw e
          } catch (e: Exception) {
            throw CodedException("IMPORT_UNREADABLE", "Strongroom couldn't read that file. Pick it again, or export again from Google Password Manager.", e)
          }
          guard { check(VaultHolder.get(context).isUnlocked) { "locked" } }
          VaultHolder.pendingImport = parsed
          VaultHolder.pendingImportName = displayName(uri)
          mapOf("found" to parsed.logins.size, "merged" to parsed.merged, "flagged" to parsed.flagged, "others" to parsed.cardsAndNotes.size)
        }
      }
    }

    // §15.4: the scan screen owns the camera and the parsed confirmation; this only ferries the scanned URI,
    // which is stored by Add/Edit's save. Null when the scan is cancelled.
    AsyncFunction("scanQr") Coroutine { ->
      val raw = awaitScan(MODE_TOTP) ?: return@Coroutine null
      val totp = Otp.parse(raw) ?: throw CodedException("SCAN_BAD_URI", "That QR is not an authenticator code.", null)
      mapOf("raw" to raw, "issuer" to totp.issuer, "account" to totp.account, "algorithm" to totp.algorithm.name, "digits" to totp.digits, "period" to totp.period)
    }

    // §15.5: one Authenticator export batch. Each call scans, decodes and accumulates one batch;
    // the returned progress says where the sequence stands. Null when the scan is cancelled.
    AsyncFunction("scanAuthenticatorBatch") Coroutine { ->
      val raw = awaitScan(MODE_MIGRATION) ?: return@Coroutine null
      val batch = withContext(Dispatchers.IO) {
        try {
          MigrationImport.parse(raw)
        } catch (e: MigrationImport.ImportError) {
          throw CodedException("MIGRATION_BAD", e.message ?: "That QR is not an Authenticator export code.", e)
        }
      }
      val known = VaultHolder.pendingMigrationSize
      if (known != null && known != batch.batchSize) {
        throw CodedException("MIGRATION_STATE", "This export's batch count changed between QRs. Start the export again.", null)
      }
      // A re-scanned index replaces its batch — the natural fix for a mis-scanned QR.
      val batches = VaultHolder.pendingMigration ?: HashMap<Int, String>().also { VaultHolder.pendingMigration = it }
      batches[batch.batchIndex] = raw
      if (known == null) VaultHolder.pendingMigrationSize = batch.batchSize
      val parsed = batches.values.map { MigrationImport.parse(it) }
      mapOf(
        "scanned" to batches.size,
        "total" to batch.batchSize,
        "entries" to parsed.sumOf { it.entries.size },
        "hotp" to parsed.sumOf { p -> p.entries.count { q -> q.type == 1L } },
      )
    }

    // §15.5: the review list, once every batch is scanned — which logins the codes attach to,
    // which become new logins, and the dropped counts. The commit writes exactly this.
    Function("authenticatorReview") {
      guard {
        val v = vault()
        check(v.isUnlocked) { "locked" }
        val pending = VaultHolder.pendingMigration
        val size = VaultHolder.pendingMigrationSize
        if (size == null || pending == null || pending.size != size) {
          throw CodedException("MIGRATION_INCOMPLETE", "Scan every QR of the export first.", null)
        }
        val batches = pending.values.map { MigrationImport.parse(it) }
        val existing = v.all().mapNotNull { (id, e) -> (e as? Entry.Login)?.let { MigrationImport.Existing(id, it.name, it.username, it.totp) } }
        val review = MigrationImport.review(batches, existing)
        VaultHolder.pendingMigrationReview = review
        mapOf(
          "items" to review.items.map { item ->
            when (item) {
              is MigrationImport.Item.Attach -> mapOf("kind" to "attach", "login" to item.loginName, "issuer" to item.issuer, "account" to item.account)
              is MigrationImport.Item.Create -> mapOf("kind" to "create", "name" to item.loginName, "issuer" to item.issuer, "account" to item.account)
            }
          },
          "created" to review.created,
          "attached" to review.attached,
          "duplicates" to review.duplicates,
          "hotp" to review.hotp,
          "bad" to review.bad,
        )
      }
    }

    // §15.5: one transaction — the new logins and the attach-edits are sealed and written in one
    // store write; the import log counts the new logins (an attach is an edit, not an import).
    Function("commitAuthenticatorImport") {
      guard {
        val v = vault()
        check(v.isUnlocked) { "locked" }
        val review = VaultHolder.pendingMigrationReview ?: throw CodedException("NO_MIGRATION", "Scan the export's QRs first.", null)
        val all = v.all()
        val writes = ArrayList<Pair<String?, Entry>>()
        var created = 0
        var attached = 0
        for (item in review.items) {
          when (item) {
            is MigrationImport.Item.Create -> {
              writes += null to Entry.Login(name = item.loginName, username = item.username, password = "", sites = emptyList(), apps = emptyList(), note = "", updatedAt = 0, totp = item.totp)
              created++
            }
            is MigrationImport.Item.Attach -> {
              val stored = all[item.loginId] as? Entry.Login
              if (stored != null && stored.totp == null) {
                writes += item.loginId to stored.copy(totp = item.totp)
                attached++
              }
            }
          }
        }
        if (writes.isEmpty()) throw CodedException("MIGRATION_EMPTY", "There is nothing left to import. Scan the export again.", null)
        val at = v.putMany(writes)
        if (created > 0) {
          saveImportLog(importLog().put(at.toString(), JSONObject().put("name", "Google Authenticator").put("count", created)))
        }
        VaultHolder.refreshIndex(context)
        VaultHolder.pendingMigration = null
        VaultHolder.pendingMigrationSize = null
        VaultHolder.pendingMigrationReview = null
        mapOf("created" to created, "attached" to attached)
      }
    }

    Function("cancelAuthenticatorImport") {
      VaultHolder.pendingMigration = null
      VaultHolder.pendingMigrationSize = null
      VaultHolder.pendingMigrationReview = null
    }

    OnActivityResult { _, result ->
      if (result.requestCode == SCAN_QR) {
        val cont = pendingScan ?: return@OnActivityResult
        pendingScan = null
        // Null on cancel: the code isn't stored until the Add/Edit save puts it in the vault.
        if (cont.isActive) cont.resume(result.data?.getStringExtra(SCAN_TOTP_EXTRA)?.takeIf { result.resultCode == Activity.RESULT_OK })
        return@OnActivityResult
      }
      if (result.requestCode != PICK_CSV && result.requestCode != SAVE_CSV) return@OnActivityResult
      val cont = pendingPick ?: return@OnActivityResult
      pendingPick = null
      if (cont.isActive) cont.resume(result.data?.data?.takeIf { result.resultCode == Activity.RESULT_OK })
    }

    Function("commitImport") {
      guard {
        val v = vault()
        check(v.isUnlocked) { "locked" }
        val parsed = VaultHolder.pendingImport ?: throw CodedException("NO_IMPORT", "Pick the Google Passwords file first.", null)
        VaultHolder.pendingImport = null
        val entries = parsed.logins + parsed.cardsAndNotes
        val at = v.putMany(entries)
        saveImportLog(importLog().put(at.toString(), JSONObject().put("name", VaultHolder.pendingImportName ?: "").put("count", entries.size)))
        VaultHolder.refreshIndex(context)
        entries.size
      }
    }

    Function("imports") {
      guard {
        val log = importLog()
        vault().imports(log.keys().asSequence().mapNotNull { it.toLongOrNull() }.toSet()).map { (at, count) ->
          val made = log.optJSONObject(at.toString())
          mapOf("at" to at, "name" to made?.optString("name")?.ifEmpty { null }, "count" to count, "imported" to made?.optInt("count"))
        }
      }
    }

    Function("deleteImport") { at: Double ->
      guard {
        val n = vault().deleteImport(at.toLong())
        saveImportLog(importLog().apply { remove(at.toLong().toString()) })
        VaultHolder.refreshIndex(context)
        n
      }
    }

    AsyncFunction("deleteAll") Coroutine { password: String ->
      val v = vault()
      if (!passwordOk(v, password)) {
        null
      } else {
        val n = withContext(Dispatchers.IO) {
          // Pull first so entries added on other devices since the last sync go too; offline, delete what this phone has.
          if (VaultHolder.sync(context).isOn) runCatching { VaultHolder.syncNow(context) }
          guard { v.deleteAll() }
        }
        VaultHolder.prefs(context).edit().remove(VaultHolder.IMPORTS).apply()
        VaultHolder.refreshIndex(context)
        n
      }
    }

    AsyncFunction("exportAll") Coroutine { password: String ->
      if (!passwordOk(vault(), password)) {
        null
      } else {
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
          .addCategory(Intent.CATEGORY_OPENABLE)
          .setType("text/csv")
          .putExtra(Intent.EXTRA_TITLE, "Strongroom passwords ${LocalDate.now()}.csv")
        val uri = awaitDocument(intent, SAVE_CSV)
          ?: throw CodedException("EXPORT_CANCELLED", "Nothing was exported because no place to save it was picked. Tap Export and choose where to save the file.", null)
        withContext(Dispatchers.IO) {
          try {
            val entries = guard { vault().all().values }
            val bytes = CsvExport.csv(entries).toByteArray(Charsets.UTF_8)
            try {
              context.contentResolver.openOutputStream(uri, "wt")?.use { it.write(bytes) } ?: throw IOException("no stream")
            } finally {
              bytes.fill(0)
            }
            mapOf("logins" to entries.count { it is Entry.Login }, "cards" to entries.count { it is Entry.Card }, "notes" to entries.count { it is Entry.Note }, "passesSkipped" to entries.count { it is Entry.Pass })
          } catch (e: Exception) {
            // The picker already made the file: don't leave an empty or half-written one behind.
            runCatching { DocumentsContract.deleteDocument(context.contentResolver, uri) }
            throw if (e is IOException || e is SecurityException) {
              CodedException("EXPORT_FAILED", "Strongroom couldn't write the file. Try again and pick another place to save it.", e)
            } else {
              e
            }
          }
        }
      }
    }

    AsyncFunction("setBiometric") Coroutine { enabled: Boolean, password: String? ->
      val v = vault()
      if (!enabled) {
        VaultHolder.disableBiometric(context)
        true
      } else if (password == null) {
        false
      } else {
        val activity = activity()
        if (!BiometricKey.available(activity)) {
          throw CodedException("NO_FINGERPRINT", "This phone has no fingerprint set up. Add one in the phone's settings, then try again.", null)
        }
        val pw = password.toCharArray()
        val key = try {
          withContext(Dispatchers.IO) { derive { v.vaultKeyCopy(pw) } }
        } finally {
          pw.fill('\u0000')
        }
        key != null && try {
          withContext(Dispatchers.Main) { awaitPrompt { done -> VaultHolder.enableBiometric(activity, key, done) } }
        } finally {
          key.fill(0)
        }
      }
    }

    Function("setAutoLockMinutes") { minutes: Int ->
      guard {
        vault().autoLockMinutes = minutes
        VaultHolder.prefs(context).edit().putInt(VaultHolder.AUTO_LOCK, minutes).apply()
        VaultHolder.touch()
      }
    }

    Function("setKeepAlive") { enable: Boolean ->
      VaultHolder.prefs(context).edit().putBoolean(VaultHolder.KEEP_ALIVE, enable).apply()
      if (enable) KeepAliveService.start(context) else KeepAliveService.stop(context)
    }

    // Ids, flag kinds and counts only: no password, and nothing derived from one, crosses the bridge.
    AsyncFunction("passwordCheck") Coroutine { ->
      withContext(Dispatchers.Default) { guard { PasswordHealth.check(vault().all(), CommonPasswords.set).toMap() } }
    }

    Function("setExpiryShare") { on: Boolean, names: Boolean ->
      guard { ExpiryShare.set(context, on, names) { vault().all() } }
    }

    Function("setSmsFill") { enable: Boolean ->
      VaultHolder.prefs(context).edit().putBoolean(VaultHolder.SMS_FILL, enable).apply()
      if (!enable) SmsCodes.clear() // nothing lingers behind a turned-off toggle
    }

    AsyncFunction("changePassword") Coroutine { oldPw: String, newPw: String ->
      vault()
      val old = oldPw.toCharArray()
      val new = newPw.toCharArray()
      try {
        withContext(Dispatchers.IO) { derive { VaultHolder.sync(context).changePassword(old, new) }.also { if (it) VaultHolder.syncSoon(context, 0) } }
      } finally {
        old.fill('\u0000')
        new.fill('\u0000')
      }
    }

    AsyncFunction("newRecoveryKey") Coroutine { password: String ->
      vault()
      val pw = password.toCharArray()
      try {
        withContext(Dispatchers.IO) { derive { VaultHolder.sync(context).newRecoveryKey(pw) }?.also { VaultHolder.syncSoon(context, 0) } }?.let { key ->
          try {
            RecoveryKey.format(key)
          } finally {
            key.fill(0)
          }
        }
      } finally {
        pw.fill('\u0000')
      }
    }

    Function("clearLostSaves") {
      vault()
      VaultHolder.prefs(context).edit().putInt(VaultHolder.LOST_SAVES, 0).apply()
    }

    Function("openAutofillSettings") {
      vault()
      val intent = Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE, Uri.parse("package:${context.packageName}"))
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    Function("setPalette") { json: String ->
      vault()
      VaultHolder.prefs(context).edit().putString(VaultHolder.PALETTE, json).apply()
    }

    Function("diagnostics") {
      vault()
      val prefs = VaultHolder.prefs(context)
      mapOf(
        "lastUnlockMs" to prefs.getLong(VaultHolder.LAST_UNLOCK_MS, -1).takeIf { it >= 0 },
        "browsers" to Browsers.ALLOWLIST.map { it.pkg }.distinct().map { pkg ->
          val info = try {
            context.packageManager.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES)
          } catch (e: PackageManager.NameNotFoundException) {
            null
          }
          val digest = info?.signerSha256()
          mapOf("pkg" to pkg, "installed" to (info != null), "trusted" to (digest != null && AppId(pkg, digest) in Browsers.ALLOWLIST))
        },
      )
    }

    // Not vault(): a footer that reads the status must not keep the vault open.
    Function("syncStatus") { VaultHolder.sync(context).status().toMap() }

    AsyncFunction("enableSync") Coroutine { setupToken: String, password: String, recoveryKey: String ->
      vault()
      val rk = RecoveryKey.parse(recoveryKey) ?: throw CodedException("BAD_RECOVERY_KEY", "That recovery key isn't complete. Check it and try again.", null)
      val pw = password.toCharArray()
      try {
        withContext(Dispatchers.IO) { syncCall { VaultHolder.sync(context).enable(setupToken.trim(), pw, rk) } }?.let { ak ->
          SyncJobService.schedule(context)
          try {
            mapOf("accountKey" to AccountKey.format(ak))
          } finally {
            ak.fill(0)
          }
        }
      } finally {
        pw.fill('\u0000')
        rk.fill(0)
      }
    }

    AsyncFunction("showAccountKey") Coroutine { password: String ->
      vault()
      val pw = password.toCharArray()
      try {
        withContext(Dispatchers.IO) { syncCall { VaultHolder.sync(context).showAccountKey(pw) } }?.let { ak ->
          try {
            AccountKey.format(ak)
          } finally {
            ak.fill(0)
          }
        }
      } finally {
        pw.fill('\u0000')
      }
    }

    AsyncFunction("signInSync") Coroutine { password: String, accountKey: String ->
      vault()
      val ak = AccountKey.parse(accountKey) ?: throw CodedException("BAD_ACCOUNT_KEY", "That account key isn't complete. Check it and try again.", null)
      val pw = password.toCharArray()
      try {
        withContext(Dispatchers.IO) {
          syncCall { VaultHolder.sync(context).signIn(pw, ak) }
          SyncJobService.schedule(context)
          VaultHolder.afterUnlock(context, byPassword = true)
        }
      } finally {
        pw.fill('\u0000')
        ak.fill(0)
      }
    }

    AsyncFunction("recoverSync") Coroutine { recoveryKey: String, newPassword: String, accountKey: String? ->
      vault()
      val rk = RecoveryKey.parse(recoveryKey) ?: throw CodedException("BAD_RECOVERY_KEY", "That recovery key isn't complete. Check it and try again.", null)
      val ak = accountKey?.let {
        AccountKey.parse(it) ?: throw CodedException("BAD_ACCOUNT_KEY", "That account key isn't complete. Check it and try again.", null)
      }
      val pw = newPassword.toCharArray()
      try {
        withContext(Dispatchers.IO) {
          syncCall { VaultHolder.sync(context).recover(rk, pw, ak) }
          SyncJobService.schedule(context)
          VaultHolder.afterUnlock(context, byPassword = true)
        }
      } finally {
        pw.fill('\u0000')
        rk.fill(0)
        ak?.fill(0)
      }
    }

    AsyncFunction("passImage") Coroutine { id: String, widthPx: Int ->
      val pass = passOf(id)
      val matrix = when (val r = Barcode.encodeMatrix(pass.code, pass.format.id)) {
        is BarcodeResult.Ok -> r.matrix
        is BarcodeResult.Error -> throw CodedException("BAD_PASS", r.message, null)
      }
      withContext(Dispatchers.Default) { PassImage.dataUri(matrix, widthPx.coerceIn(1, MAX_PASS_PX)) }
    }

    AsyncFunction("presentPass") Coroutine { id: String ->
      val pass = passOf(id)
      val hasHce = context.packageManager.hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION)
      val adapter = NfcAdapter.getDefaultAdapter(context)
      if (!hasHce || adapter == null) throw CodedException("NO_NFC", "This phone can't present a pass over NFC. Show the barcode instead.", null)
      if (!adapter.isEnabled) throw CodedException("NFC_OFF", "NFC is off. Turn it on in the phone's settings, then try again.", null)
      val tooLong = CodedException("CODE_TOO_LONG", "This code is too long to present over NFC. Show the barcode instead.", null)
      if (!Presenting.arm(pass.code)) throw tooLong
      // The vault can lock between the read above and the arm; its lock hook then ran before there was anything to disarm. Not nested in the vault's monitor: Vault.onLock takes Presenting's, so the reverse order could deadlock.
      if (!VaultHolder.get(context).isUnlocked) {
        Presenting.disarm()
        throw CodedException("LOCKED", "Strongroom is locked. Unlock it and try again.", null)
      }
      val a = activity()
      val routed = withContext(Dispatchers.Main) { runCatching { CardEmulation.getInstance(adapter).setPreferredService(a, Presenting.serviceComponent(a)) }.getOrDefault(false) }
      if (!routed) {
        Presenting.disarm()
        throw CodedException("NFC_BUSY", "Strongroom couldn't take over NFC. Keep Strongroom open and try again.", null)
      }
      main.removeCallbacks(autoStop)
      main.postDelayed(autoStop, Type4Tag.DEFAULT_TTL_MS)
      mapOf("expiresInMs" to Type4Tag.DEFAULT_TTL_MS)
    }

    AsyncFunction("stopPresenting") { stopPresenting() }

    AsyncFunction("setBright") { on: Boolean ->
      val a = activity()
      a.runOnUiThread { a.window.attributes = a.window.attributes.apply { screenBrightness = if (on) 1f else WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE } }
    }

    // Not vault(): the status holds a lock across a network call and a screen reads it while locked.
    AsyncFunction("emailRecoveryStatus") Coroutine { ->
      val r = withContext(Dispatchers.IO) { VaultHolder.recovery(context).status() }
      mapOf(
        "available" to r.available, "checked" to r.checked, "enrolled" to r.enrolled, "waitingForCode" to r.waitingForCode,
        "pendingRecovery" to r.pendingRecovery?.let { mapOf("releaseAt" to it.releaseAt) },
        "wasTurnedOff" to r.wasTurnedOff, "keyUnseen" to r.keyUnseen,
      )
    }

    AsyncFunction("enableEmailRecovery") Coroutine { email: String, password: String ->
      vault()
      val pw = password.toCharArray()
      try {
        withContext(Dispatchers.IO) { syncCall { VaultHolder.recovery(context).enrol(email, pw) }?.also { VaultHolder.syncSoon(context, 0) } }?.let { e ->
          try {
            mapOf("recoveryKey" to RecoveryKey.format(e.recoveryKey), "sent" to e.sent)
          } finally {
            e.recoveryKey.fill(0)
          }
        }
      } finally {
        pw.fill('\u0000')
      }
    }

    AsyncFunction("confirmEmailRecovery") Coroutine { code: String ->
      vault()
      withContext(Dispatchers.IO) { syncCall { VaultHolder.recovery(context).confirm(code) } }
    }

    AsyncFunction("turnOffEmailRecovery") Coroutine { ->
      vault()
      withContext(Dispatchers.IO) { syncCall { VaultHolder.recovery(context).turnOff() } }
    }

    // Not vault() from here on in this group: Unlock reaches them with the vault locked, and the sign-in token lives in the Keystore, not the vault.
    AsyncFunction("cancelLostRequest") Coroutine { ->
      withContext(Dispatchers.IO) { syncCall { VaultHolder.recovery(context).cancelLost() } }
    }

    AsyncFunction("markRecoveryKeyShown") Coroutine { ->
      withContext(Dispatchers.IO) { syncCall { VaultHolder.recovery(context).keyShown() } }
    }

    AsyncFunction("lostAccessRequest") Coroutine { ->
      withContext(Dispatchers.IO) { syncCall { VaultHolder.recovery(context).lostRequest() } }
    }

    AsyncFunction("lostAccessCheck") Coroutine { ->
      when (val s = withContext(Dispatchers.IO) { syncCall { VaultHolder.recovery(context).lostCheck() } }) {
        is LostState.None -> mapOf("state" to "none")
        is LostState.Waiting -> mapOf("state" to "waiting", "releaseAt" to s.releaseAt)
        is LostState.Ready -> mapOf("state" to "ready")
      }
    }

    AsyncFunction("lostAccessOpen") Coroutine { code: String, newPassword: String ->
      val pw = newPassword.toCharArray()
      try {
        withContext(Dispatchers.IO) {
          syncCall { VaultHolder.recovery(context).lostOpen(code, pw) }.also {
            if (it) {
              SyncJobService.schedule(context)
              VaultHolder.afterUnlock(context, byPassword = true)
            }
          }
        }
      } finally {
        pw.fill('\u0000')
      }
    }

    // A new device signs in by email: the first two need no vault or account; open is signInSync with the account key taken from the emailed code.
    AsyncFunction("emailSignInRequest") Coroutine { ->
      withContext(Dispatchers.IO) { syncCall { VaultHolder.recovery(context).signinRequest() } }
    }

    AsyncFunction("emailSignInCheck") Coroutine { ->
      when (val s = withContext(Dispatchers.IO) { syncCall { VaultHolder.recovery(context).signinCheck() } }) {
        is LostState.None -> mapOf("state" to "none")
        is LostState.Waiting -> mapOf("state" to "waiting", "releaseAt" to s.releaseAt)
        is LostState.Ready -> mapOf("state" to "ready")
      }
    }

    AsyncFunction("emailSignInOpen") Coroutine { code: String, password: String ->
      vault()
      val pw = password.toCharArray()
      try {
        withContext(Dispatchers.IO) {
          syncCall { VaultHolder.recovery(context).signinOpen(code, pw) }.also {
            if (it) {
              SyncJobService.schedule(context)
              VaultHolder.afterUnlock(context, byPassword = true)
            }
          }
        }
      } finally {
        pw.fill('\u0000')
      }
    }

    AsyncFunction("syncNow") Coroutine { ->
      vault()
      val r = withContext(Dispatchers.IO) { syncCall { VaultHolder.syncNow(context) } }
      mapOf(
        "pulled" to r.pulled, "pushed" to r.pushed, "conflicts" to r.conflicts,
        "quarantined" to r.quarantined, "blocked" to r.blocked, "headerChanged" to r.headerChanged,
      )
    }
  }

  private suspend fun passOf(id: String): Entry.Pass =
    withContext(Dispatchers.IO) { guard { vault().get(id) } } as? Entry.Pass
      ?: throw CodedException("NOT_FOUND", "That pass is gone. Go back to the list and pick another.", null)

  private fun readGoogleCsv(uri: Uri): ImportResult {
    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readNBytes(MAX_CSV_BYTES + 1) } ?: throw IOException("no stream")
    try {
      if (bytes.size > MAX_CSV_BYTES) throw CodedException("IMPORT_TOO_BIG", "That file is too big to be a Google Passwords export.", null)
      return try {
        GoogleImport.parse(String(bytes, Charsets.UTF_8), System.currentTimeMillis())
      } catch (e: ImportError) {
        throw CodedException("IMPORT_ERROR", e.message, e)
      }
    } finally {
      bytes.fill(0)
    }
  }

  private suspend fun awaitDocument(intent: Intent, code: Int): Uri? = withContext(Dispatchers.Main) {
    suspendCancellableCoroutine { cont ->
      appContext.throwingActivity.startActivityForResult(intent, code)
      pendingPick?.let { if (it.isActive) it.resume(null) }
      pendingPick = cont
    }
  }

  private suspend fun awaitScan(mode: String): String? = withContext(Dispatchers.Main) {
    suspendCancellableCoroutine { cont ->
      appContext.throwingActivity.startActivityForResult(
        Intent(context, ScanActivity::class.java).putExtra(SCAN_MODE, mode),
        SCAN_QR,
      )
      pendingScan?.let { if (it.isActive) it.resume(null) }
      pendingScan = cont
    }
  }

  private suspend fun passwordOk(v: Vault, password: String): Boolean {
    val pw = password.toCharArray()
    return try {
      withContext(Dispatchers.IO) { derive { v.vaultKeyCopy(pw) } }?.also { it.fill(0) } != null
    } finally {
      pw.fill('\u0000')
    }
  }

  // stamp -> {name, count} for each import made on this phone. The vault knows imports only by stamp (Vault.imports); this adds the file name.
  private fun importLog(): JSONObject = try {
    JSONObject(VaultHolder.prefs(context).getString(VaultHolder.IMPORTS, null) ?: "{}")
  } catch (e: JSONException) {
    JSONObject()
  }

  private fun saveImportLog(log: JSONObject) = VaultHolder.prefs(context).edit().putString(VaultHolder.IMPORTS, log.toString()).apply()

  private fun displayName(uri: Uri): String? =
    runCatching { context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } }.getOrNull()
}

internal fun coded(e: IllegalStateException): Exception = when (e.message) {
  "locked" -> CodedException("LOCKED", "Strongroom is locked. Unlock it and try again.", e)
  "not set up" -> CodedException("NOT_SET_UP", "Strongroom isn't set up on this phone yet. Set it up first.", e)
  "already set up" -> CodedException("ALREADY_SET_UP", "Strongroom is already set up on this phone.", e)
  "header unreadable" ->
    CodedException("HEADER_UNREADABLE", "Strongroom can't read this vault's settings, so it can't open it. The vault file may be damaged.", e)
  "sync unavailable" -> CodedException("SYNC_UNAVAILABLE", "Sync isn't available in this build.", e)
  "sync off" -> CodedException("SYNC_OFF", "Sync is off. Turn it on in Settings first.", e)
  "sync already on" -> CodedException("SYNC_ALREADY_ON", "Sync is already on for this phone.", e)
  "wrong recovery key" -> CodedException(
    "WRONG_RECOVERY_KEY",
    "That recovery key doesn't open this vault. Make a new one in Settings with New recovery key, write it down, then turn on sync.",
    e,
  )
  "wrong setup token" -> CodedException("WRONG_SETUP_TOKEN", "The vault server didn't accept that setup token. Check it and try again.", e)
  "account exists" -> CodedException(
    "SYNC_ACCOUNT_EXISTS",
    "The vault server already has a sync account. Sign in with your master password and account key instead.",
    e,
  )
  HEADER_CHECK -> CodedException(
    "HEADER_CHECK_FAILED",
    "Strongroom couldn't check the vault's new settings, so it changed nothing. Close Strongroom, open it again and retry.",
    e,
  )
  KEY_LOST -> CodedException(
    "SYNC_KEY_LOST",
    "This phone's secure storage lost the key that protects your sync sign-in, so sync stopped. Sign in to sync again with your master password and account key.",
    e,
  )
  "sync first" -> CodedException("SYNC_FIRST", "This phone has changes it hasn't synced yet. Choose Sync now, then try again.", e)
  "mail failed" -> CodedException("MAIL_FAILED", "We couldn't send the email, so nothing changed and your old recovery key still works. Try again later.", e)
  "vault moved" -> CodedException(
    "VAULT_MOVED",
    "Your vault changed on another device, so nothing changed and your old recovery key still works. If an email with a code arrived, ignore it. Choose Sync now, then try again.",
    e,
  )
  "not waiting" -> CodedException("NOT_WAITING_FOR_CODE", "There is no email code to enter. Turn on email recovery first.", e)
  "request alive" -> CodedException(
    "LOST_STILL_ALIVE",
    "A recovery request is already counting down on this account. Wait for it to finish, or cancel it from a device that is signed in.",
    e,
  )
  "sign-in approved" -> CodedException("SIGNIN_APPROVED", "This sign-in is already approved. Check again instead of asking again.", e)
  "sign-in not ready" -> CodedException("SIGNIN_NOT_READY", "Approve the sign-in from the email first, then check again.", e)
  "not ready" -> CodedException("LOST_NOT_READY", "The 24-hour wait isn't over yet. Try again once it ends.", e)
  "different account" -> CodedException(
    "LOST_DIFFERENT_ACCOUNT",
    "This phone is already set up with another Strongroom account, so it can't open this vault. Use a phone or a fresh install that has no Strongroom account.",
    e,
  )
  "different vault" -> CodedException(
    "DIFFERENT_VAULT",
    "This phone holds a different vault from the one on the vault server, so Strongroom changed nothing. Sign in on a phone that has no vault yet.",
    e,
  )
  else -> e
}

internal inline fun <T> guard(block: () -> T): T = try {
  block()
} catch (e: IllegalStateException) {
  throw coded(e)
}

// A header at the 1 GiB ceiling can exhaust the heap; that is refused like any out-of-range header, not a crash.
internal inline fun <T> derive(block: () -> T): T = try {
  guard(block)
} catch (e: KdfOutOfRange) {
  throw CodedException("KDF_OUT_OF_RANGE", KDF_REFUSED, e)
} catch (e: OutOfMemoryError) {
  throw CodedException("KDF_OUT_OF_RANGE", KDF_REFUSED, e)
} catch (e: AccountKeyRequired) {
  throw CodedException("ACCOUNT_KEY_REQUIRED", ACCOUNT_KEY_GONE, e)
}

// The core's sync errors already carry owner-ready copy (strongroom-core's, word for word).
internal inline fun <T> syncCall(block: () -> T): T = try {
  derive(block)
} catch (e: SyncAuthError) {
  throw CodedException("SYNC_SIGN_IN", e.message, e)
} catch (e: SyncHttpError) {
  throw CodedException("SYNC_SERVER", e.message, e)
} catch (e: SyncOfflineError) {
  throw CodedException("SYNC_OFFLINE", e.message, e)
} catch (e: SyncRollbackError) {
  throw CodedException("SYNC_ROLLBACK", e.message, e)
} catch (e: IllegalArgumentException) {
  throw if (e.message == "bad email") CodedException("BAD_EMAIL", "That email address isn't valid. Check it and try again.", e) else e
}

private fun HealthReport.toMap() = mapOf(
  "checked" to checked,
  "weak" to weak,
  "reused" to reused,
  "common" to common,
  "items" to items.map { mapOf("id" to it.id, "flags" to it.flags.map { f -> f.id }, "group" to it.reuseGroup) },
)

private fun SyncStatus.toMap() =
  mapOf("state" to state, "lastSyncAt" to lastSyncAt, "blocked" to blocked, "quarantined" to quarantined, "available" to available)

// Settles once: the owner's answer, a prompt that couldn't show, or the caller giving up (which closes the prompt).
private suspend fun awaitPrompt(start: ((Boolean) -> Unit) -> Unit): Boolean = suspendCancellableCoroutine { cont ->
  cont.invokeOnCancellation { VaultHolder.cancelBiometric() }
  start { if (cont.isActive) cont.resume(it) }
}

private fun secret(v: Vault, id: String, field: String): String {
  val e = v.get(id) ?: throw CodedException("NOT_FOUND", "That entry is gone. Go back to the list and pick another.", null)
  return when {
    e is Entry.Login && field == "username" -> e.username
    e is Entry.Login && field == "password" -> e.password
    e is Entry.Card && field == "number" -> e.number
    e is Entry.Card && field == "cvc" -> e.cvc
    e is Entry.Pass && field == "code" -> e.code
    else -> throw IllegalArgumentException("this entry has no $field")
  }
}

/** The current code for a login, refusing (NO_TOTP) when it has none. The secret never leaves the vault. */
private fun currentTotp(v: Vault, id: String): Otp.State {
  val login = v.get(id) as? Entry.Login
  val totp = login?.totp?.let(Otp::parse)
    ?: throw CodedException("NO_TOTP", "This login has no authenticator code.", null)
  return Otp.state(totp, System.currentTimeMillis() / 1000)
}

private fun view(id: String, e: Entry): Map<String, Any?>? = when (e) {
  is Entry.Login -> {
    val base = mapOf(
      "id" to id, "type" to "login", "name" to e.name, "username" to e.username,
      "sites" to e.sites.map { (if (it.https) "https://" else "http://") + it.host },
      "apps" to e.apps.map(EntryInput::appLabel),
      "note" to e.note,
    )
    // The code's shape, never its secret — the raw URI only travels through reveal and the scanner.
    e.totp?.let(Otp::parse)?.let { info ->
      base + ("totp" to mapOf("issuer" to info.issuer, "account" to info.account, "algorithm" to info.algorithm.name, "digits" to info.digits, "period" to info.period))
    } ?: base
  }
  is Entry.Card -> mapOf(
    "id" to id, "type" to "card", "name" to e.name, "holder" to e.holder,
    "last4" to e.number.filter(Char::isDigit).takeLast(4), "expMonth" to e.expMonth, "expYear" to e.expYear, "note" to e.note,
  )
  is Entry.Note -> mapOf("id" to id, "type" to "note", "name" to e.name, "note" to "", "text" to e.text)
  is Entry.Pass -> mapOf("id" to id, "type" to "pass", "name" to e.name, "format" to e.format.id, "note" to e.note)
  is Entry.Deleted -> null
}

internal fun PackageInfo.signerSha256(): String? =
  signingInfo?.apkContentsSigners?.firstOrNull()?.let { sig ->
    MessageDigest.getInstance("SHA-256").digest(sig.toByteArray()).joinToString("") { "%02x".format(it.toInt() and 0xff) }
  }
