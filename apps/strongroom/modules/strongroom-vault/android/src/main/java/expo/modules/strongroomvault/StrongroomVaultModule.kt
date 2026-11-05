package expo.modules.strongroomvault

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.provider.Settings
import android.view.autofill.AutofillManager
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.strongroomvault.android.BiometricKey
import expo.modules.strongroomvault.android.EntryInput
import expo.modules.strongroomvault.android.SecretFieldView
import expo.modules.strongroomvault.android.SensitiveClipboard
import expo.modules.strongroomvault.android.SyncJobService
import expo.modules.strongroomvault.android.VaultHolder
import expo.modules.strongroomvault.core.AccountKey
import expo.modules.strongroomvault.core.AccountKeyRequired
import expo.modules.strongroomvault.core.AppId
import expo.modules.strongroomvault.core.Browsers
import expo.modules.strongroomvault.core.Entry
import expo.modules.strongroomvault.core.GoogleImport
import expo.modules.strongroomvault.core.HEADER_CHECK
import expo.modules.strongroomvault.core.KEY_LOST
import expo.modules.strongroomvault.core.ImportError
import expo.modules.strongroomvault.core.ImportResult
import expo.modules.strongroomvault.core.KdfOutOfRange
import expo.modules.strongroomvault.core.RecoveryKey
import expo.modules.strongroomvault.core.SyncAuthError
import expo.modules.strongroomvault.core.SyncHttpError
import expo.modules.strongroomvault.core.SyncOfflineError
import expo.modules.strongroomvault.core.SyncRollbackError
import expo.modules.strongroomvault.core.SyncStatus
import expo.modules.strongroomvault.core.Vault
import java.io.IOException
import java.security.MessageDigest
import kotlin.coroutines.resume
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

private const val LOCK_EVENT = "onLock"
private const val SYNC_EVENT = "onSync"
private const val PICK_CSV = 7401
private const val MAX_CSV_BYTES = 5 * 1024 * 1024
internal const val KDF_REFUSED =
  "Strongroom won't open this vault: its security settings are weaker than it allows. The vault file may have been changed."
internal const val ACCOUNT_KEY_GONE =
  "This phone no longer holds your account key, so your master password can't open the vault on its own. Sign in to sync with your master password and account key."

class StrongroomVaultModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  private var pendingPick: CancellableContinuation<Uri?>? = null

  // Vault.touch() runs the expiry check before it refreshes, so a session that has run out is locked, not revived.
  private fun vault(): Vault = VaultHolder.get(context).also { VaultHolder.touch() }

  private fun activity(): FragmentActivity =
    appContext.currentActivity as? FragmentActivity ?: throw CodedException("NO_ACTIVITY", "Open Strongroom and try again.", null)

  override fun definition() = ModuleDefinition {
    Name("StrongroomVault")

    Events(LOCK_EVENT, SYNC_EVENT)

    OnCreate {
      VaultHolder.lockListener = { sendEvent(LOCK_EVENT) }
      VaultHolder.syncListener = { sendEvent(SYNC_EVENT, it.toMap()) }
    }

    OnDestroy {
      VaultHolder.lockListener = null
      VaultHolder.syncListener = null
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
        withContext(Dispatchers.Main) { awaitPrompt { done -> VaultHolder.biometricUnlock(activity, done) } }
      }
    }

    AsyncFunction("recover") Coroutine { recoveryKey: String, newPassword: String ->
      vault()
      val rk = RecoveryKey.parse(recoveryKey)
      val pw = newPassword.toCharArray()
      try {
        rk != null && withContext(Dispatchers.IO) {
          derive { VaultHolder.get(context).recover(rk, pw) }.also {
            if (it) {
              VaultHolder.headerChanged(context, pw, null)
              VaultHolder.afterUnlock(context, byPassword = true)
            }
          }
        }
      } finally {
        pw.fill('\u0000')
        rk?.fill(0)
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

    Function("copy") { id: String, field: String -> guard { SensitiveClipboard.copy(context, secret(vault(), id, field)) } }

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
      val uri = withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { cont ->
          appContext.throwingActivity.startActivityForResult(intent, PICK_CSV)
          pendingPick?.let { if (it.isActive) it.resume(null) }
          pendingPick = cont
        }
      }
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
          mapOf("found" to parsed.logins.size, "merged" to parsed.merged, "flagged" to parsed.flagged)
        }
      }
    }

    OnActivityResult { _, result ->
      if (result.requestCode != PICK_CSV) return@OnActivityResult
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
        val count = v.putMany(parsed.logins)
        VaultHolder.refreshIndex(context)
        count
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

    AsyncFunction("changePassword") Coroutine { oldPw: String, newPw: String ->
      val v = vault()
      val old = oldPw.toCharArray()
      val new = newPw.toCharArray()
      try {
        withContext(Dispatchers.IO) { derive { v.changePassword(old, new) }.also { if (it) VaultHolder.headerChanged(context, new, null) } }
      } finally {
        old.fill('\u0000')
        new.fill('\u0000')
      }
    }

    AsyncFunction("newRecoveryKey") Coroutine { password: String ->
      val v = vault()
      val pw = password.toCharArray()
      try {
        withContext(Dispatchers.IO) { derive { v.newRecoveryKey(pw) }?.also { VaultHolder.headerChanged(context, null, it) } }?.let { key ->
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

    AsyncFunction("syncNow") Coroutine { ->
      vault()
      val r = withContext(Dispatchers.IO) { syncCall { VaultHolder.syncNow(context) } }
      mapOf(
        "pulled" to r.pulled, "pushed" to r.pushed, "conflicts" to r.conflicts,
        "quarantined" to r.quarantined, "blocked" to r.blocked, "headerChanged" to r.headerChanged,
      )
    }
  }

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
}

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
    else -> throw IllegalArgumentException("this entry has no $field")
  }
}

private fun view(id: String, e: Entry): Map<String, Any?>? = when (e) {
  is Entry.Login -> mapOf(
    "id" to id, "type" to "login", "name" to e.name, "username" to e.username,
    "sites" to e.sites.map { (if (it.https) "https://" else "http://") + it.host },
    "apps" to e.apps.map { a -> a.domain?.let { "${a.app.pkg} ($it)" } ?: a.app.pkg },
    "note" to e.note,
  )
  is Entry.Card -> mapOf(
    "id" to id, "type" to "card", "name" to e.name, "holder" to e.holder,
    "last4" to e.number.filter(Char::isDigit).takeLast(4), "expMonth" to e.expMonth, "expYear" to e.expYear, "note" to e.note,
  )
  is Entry.Note -> mapOf("id" to id, "type" to "note", "name" to e.name, "note" to "", "text" to e.text)
  is Entry.Deleted -> null
}

internal fun PackageInfo.signerSha256(): String? =
  signingInfo?.apkContentsSigners?.firstOrNull()?.let { sig ->
    MessageDigest.getInstance("SHA-256").digest(sig.toByteArray()).joinToString("") { "%02x".format(it.toInt() and 0xff) }
  }
