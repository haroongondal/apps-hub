package expo.modules.strongroomvault.android

import android.app.KeyguardManager
import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.util.AtomicFile
import androidx.biometric.BiometricPrompt
import androidx.fragment.app.FragmentActivity
import expo.modules.strongroomvault.core.ImportResult
import expo.modules.strongroomvault.core.IndexItem
import expo.modules.strongroomvault.core.LockPolicy
import expo.modules.strongroomvault.core.MatchIndex
import expo.modules.strongroomvault.core.PendingSave
import expo.modules.strongroomvault.core.Saves
import expo.modules.strongroomvault.core.Sealer
import expo.modules.strongroomvault.core.SyncMode
import expo.modules.strongroomvault.core.SyncReport
import expo.modules.strongroomvault.core.SyncSecret
import expo.modules.strongroomvault.core.SyncSession
import expo.modules.strongroomvault.core.SyncSettings
import expo.modules.strongroomvault.core.SyncState
import expo.modules.strongroomvault.core.SyncStatus
import expo.modules.strongroomvault.core.Vault
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

object VaultHolder {
  internal const val AUTO_LOCK = "autoLockMinutes"
  internal const val BIOMETRIC = "biometricEnabled"
  internal const val PASSWORD_BOOT = "passwordUnlockBoot"
  internal const val PALETTE = "palette"
  internal const val LAST_UNLOCK_MS = "lastUnlockMs"
  internal const val LOST_SAVES = "lostSaves"
  private const val INDEX_FILE = "index.bin"
  private const val PENDING_FILE = "pending.bin"
  private const val BIOMETRIC_FILE = "biometric.bin"
  private const val CHANGE_SYNC_DELAY_MS = 2_000L

  @Volatile private var vault: Vault? = null
  @Volatile private var session: SyncSession? = null
  @Volatile private var app: Context? = null
  @Volatile private var prompt: BiometricPrompt? = null

  @Volatile internal var pendingImport: ImportResult? = null

  /** Set by the module while JS is listening; runs on the main thread, never inside the vault's monitor. */
  @Volatile internal var lockListener: (() -> Unit)? = null

  @Volatile internal var syncListener: ((SyncStatus) -> Unit)? = null

  private val timer = Executors.newSingleThreadScheduledExecutor { Thread(it, "strongroom-autolock").apply { isDaemon = true } }
  private var expiry: ScheduledFuture<*>? = null
  private val syncer = Executors.newSingleThreadScheduledExecutor { Thread(it, "strongroom-sync").apply { isDaemon = true } }
  private var nextSync: ScheduledFuture<*>? = null
  private var unlockPassword: CharArray? = null
  private val pendingFile = Any()
  private val indexFile = Any()
  private val main = Handler(Looper.getMainLooper())

  internal fun prefs(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences("strongroom", Context.MODE_PRIVATE)

  fun get(context: Context): Vault = vault ?: synchronized(this) {
    vault ?: run {
      val ctx = context.applicationContext
      val store = SqliteRecordStore(ctx)
      val secrets = KeystoreSyncSecrets(ctx.filesDir)
      Vault(store, System::currentTimeMillis, SystemClock::elapsedRealtime) { secrets.get(SyncSecret.ACCOUNT_KEY) }.also {
        it.autoLockMinutes = prefs(context).getInt(AUTO_LOCK, 5).takeIf(LockPolicy::validTimeout) ?: 5
        it.onLock = {
          dropUnlockPassword()
          main.post { lockListener?.invoke() }
        }
        val s = SyncSession(it, store, secrets, PrefsSyncSettings(prefs(ctx)), SyncConfig.transport(), System::currentTimeMillis)
        s.onChange = { main.post { syncListener?.invoke(s.status()) } }
        session = s
        app = ctx
        vault = it
        if (s.isOn) SyncJobService.schedule(ctx)
      }
    }
  }

  fun sync(context: Context): SyncSession {
    get(context)
    return session!!
  }

  /** One sync on the sync thread after [delayMs], replacing one not yet started. [password] (an unlock's copy) is zeroed after that run. */
  internal fun syncSoon(context: Context, delayMs: Long, password: CharArray? = null) {
    val s = sync(context)
    synchronized(syncer) {
      if (!s.isOn) {
        password?.fill('\u0000')
        return
      }
      if (password != null) {
        unlockPassword?.fill('\u0000')
        unlockPassword = password
      }
      nextSync?.cancel(false)
      nextSync = syncer.schedule(Runnable { runSync(context.applicationContext) }, delayMs, TimeUnit.MILLISECONDS)
    }
  }

  internal fun syncNow(context: Context, password: CharArray? = null): SyncReport =
    sync(context).sync(password).also { if (it.pulled > 0) rebuildIndex(context) }

  // The copy stays in the field while its run uses it, so a lock zeroes it there too (a zeroed password only makes R10 adoption refuse).
  private fun runSync(context: Context) {
    val pw = synchronized(syncer) { unlockPassword }
    try {
      syncNow(context, pw)
    } catch (e: Exception) {
      // The status already tells the screens what went wrong, and the next unlock, change or job tries again.
    } finally {
      synchronized(syncer) { if (unlockPassword === pw) dropUnlockPassword() }
    }
  }

  private fun dropUnlockPassword() = synchronized(syncer) {
    unlockPassword?.fill('\u0000')
    unlockPassword = null
  }

  fun download(context: Context) {
    runCatching { sync(context).download() }
  }

  fun touch() {
    val v = vault ?: return
    v.touch()
    scheduleLock()
  }

  val lostSaves: Int get() = app?.let { prefs(it).getInt(LOST_SAVES, 0) } ?: 0

  fun index(context: Context): List<IndexItem> {
    val plain = synchronized(indexFile) { file(context, INDEX_FILE).readOrNull() }?.let(DeviceKey::open)
    return try {
      MatchIndex.decode(plain)
    } finally {
      plain?.fill(0)
    }
  }

  // Every local write refreshes the index, so this is also where a change schedules its sync.
  fun refreshIndex(context: Context) {
    rebuildIndex(context)
    syncSoon(context, CHANGE_SYNC_DELAY_MS)
  }

  private fun rebuildIndex(context: Context) {
    val v = get(context)
    if (!v.isUnlocked) return
    val f = file(context, INDEX_FILE)
    synchronized(indexFile) {
      try {
        val plain = MatchIndex.encode(MatchIndex.build(v.all()))
        try {
          f.write(DeviceKey.seal(plain))
        } finally {
          plain.fill(0)
        }
      } catch (e: Exception) {
        f.delete() // a stale index could still offer a removed login; empty until the next refresh
      }
    }
  }

  fun addPending(context: Context, p: PendingSave): Boolean {
    val blob = Saves.seal(DeviceKey, p) ?: return false
    return try {
      synchronized(pendingFile) {
        val f = file(context, PENDING_FILE)
        val existing = try {
          f.readFully()
        } catch (e: FileNotFoundException) {
          ByteArray(0)
        }
        f.write(PendingFile.append(existing, blob))
      }
      true
    } catch (e: IOException) {
      false
    }
  }

  fun applyPending(context: Context): Int {
    if (context.getSystemService(KeyguardManager::class.java)?.isDeviceLocked == true) return 0 // the device key can't open anything yet
    synchronized(pendingFile) {
      val f = file(context, PENDING_FILE)
      val bytes = f.readOrNull() ?: return 0
      val plan = PendingPlan.of(bytes, DeviceKey::openPending)
      val written = try {
        Saves.apply(get(context), plan.apply)
      } catch (e: Exception) {
        return 0 // the file stays for the next unlock; applying twice changes nothing
      }
      val p = prefs(context)
      if (plan.lost > 0 && !p.edit().putInt(LOST_SAVES, p.getInt(LOST_SAVES, 0) + plan.lost).commit()) return written
      try {
        if (plan.keep.isEmpty()) f.delete() else f.write(PendingFile.join(plan.keep))
      } catch (e: IOException) {
        // the old file stays: re-applying is a no-op, and a lost save may be counted again
      }
      return written
    }
  }

  fun passwordUnlock(context: Context, password: CharArray): Boolean {
    val started = SystemClock.elapsedRealtime()
    if (!get(context).unlock(password)) return false
    prefs(context).edit().putLong(LAST_UNLOCK_MS, SystemClock.elapsedRealtime() - started).apply()
    afterUnlock(context, byPassword = true, password)
    return true
  }

  fun biometricUnlock(activity: FragmentActivity, description: CharSequence? = null, onResult: (Boolean) -> Unit) {
    val context = activity.applicationContext
    if (!biometricAllowed(context)) return onResult(false)
    val sealed = file(context, BIOMETRIC_FILE).readOrNull()?.takeIf { it.size > IV_BYTES }
    val cipher = try {
      sealed?.let { BiometricKey.decrypter(it.copyOf(IV_BYTES)) }
    } catch (e: KeyPermanentlyInvalidatedException) {
      null
    } catch (e: Exception) {
      return onResult(false)
    }
    if (sealed == null || cipher == null) {
      disableBiometric(context)
      return onResult(false)
    }
    prompt = BiometricKey.prompt(activity, cipher, "Unlock Strongroom", "Use master password", description) { done ->
      prompt = null
      if (done == null) return@prompt onResult(false)
      thread(name = "strongroom-unlock") {
        val ok = try {
          val key = done.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES)
          try {
            get(context).unlockWithKey(key)
          } finally {
            key.fill(0)
          }
        } catch (e: Exception) {
          false
        }
        if (ok) afterUnlock(context, byPassword = false)
        activity.runOnUiThread { onResult(ok) }
      }
    }
  }

  internal fun biometricAllowed(context: Context): Boolean {
    val p = prefs(context)
    val boot = bootCount(context) ?: return false
    return LockPolicy.biometricAllowed(p.getBoolean(BIOMETRIC, false), if (p.contains(PASSWORD_BOOT)) p.getInt(PASSWORD_BOOT, -1) else null, boot)
  }

  internal fun enableBiometric(activity: FragmentActivity, vaultKey: ByteArray, onResult: (Boolean) -> Unit) {
    val context = activity.applicationContext
    disableBiometric(context) // a cancelled prompt then leaves fingerprint off rather than half on
    val key = vaultKey.copyOf() // ours until the prompt ends, so a caller that gives up can't zero it under the prompt
    val cipher = try {
      BiometricKey.encrypter()
    } catch (e: Exception) {
      key.fill(0)
      throw e
    }
    val iv = cipher.iv
    prompt = BiometricKey.prompt(activity, cipher, "Turn on fingerprint unlock", "Cancel") { done ->
      prompt = null
      val ok = try {
        done != null && run {
          file(context, BIOMETRIC_FILE).write(iv + done.doFinal(key))
          prefs(context).edit().putBoolean(BIOMETRIC, true).commit()
        }
      } catch (e: Exception) {
        false
      } finally {
        key.fill(0)
      }
      onResult(ok)
    }
  }

  internal fun cancelBiometric() {
    main.post { prompt?.cancelAuthentication() }
  }

  internal fun disableBiometric(context: Context) {
    prefs(context).edit().putBoolean(BIOMETRIC, false).commit()
    file(context, BIOMETRIC_FILE).delete()
    BiometricKey.delete()
  }

  internal fun afterUnlock(context: Context, byPassword: Boolean, password: CharArray? = null) {
    if (byPassword) {
      val boot = bootCount(context)
      prefs(context).edit().apply { if (boot == null) remove(PASSWORD_BOOT) else putInt(PASSWORD_BOOT, boot) }.commit()
    }
    applyPending(context)
    rebuildIndex(context)
    scheduleLock()
    syncSoon(context, 0, password?.copyOf())
  }

  // Timer threads don't run in deep sleep, so this only narrows the window; the Vault's own check is the gate.
  private fun scheduleLock() {
    val v = vault ?: return
    synchronized(timer) {
      expiry?.cancel(false)
      val live = v.isUnlocked
      if (!live) pendingImport = null
      expiry = if (live) timer.schedule(Runnable { scheduleLock() }, v.autoLockMinutes * 60_000L, TimeUnit.MILLISECONDS) else null
    }
  }

  private fun bootCount(context: Context): Int? =
    Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1).takeIf { it >= 0 }

  private fun file(context: Context, name: String) = AtomicFile(File(context.filesDir, name))

  private fun AtomicFile.readOrNull(): ByteArray? = try {
    readFully()
  } catch (e: IOException) {
    null
  }

  private fun AtomicFile.write(bytes: ByteArray) {
    val out = startWrite()
    try {
      out.write(bytes)
      finishWrite(out)
    } catch (e: IOException) {
      failWrite(out)
      throw e
    }
  }
}

// Nothing secret here: the recovery hash is the server's own check value for a token no one can derive from it, and the pending header is a fingerprint.
internal class PrefsSyncSettings(private val p: SharedPreferences) : SyncSettings {
  override fun load() = SyncState(
    mode = SyncMode.entries.firstOrNull { it.name == p.getString("syncMode", null) } ?: SyncMode.OFF,
    lastSyncAt = p.getLong("syncLastAt", -1).takeIf { it >= 0 },
    blocked = p.getInt("syncBlocked", 0),
    quarantined = p.getInt("syncQuarantined", 0),
    failed = p.getBoolean("syncFailed", false),
    pendingHeader = p.getString("syncPendingHeader", null),
    recoveryHash = p.getString("syncRecoveryHash", null),
  )

  override fun save(s: SyncState) {
    p.edit()
      .putString("syncMode", s.mode.name)
      .putLong("syncLastAt", s.lastSyncAt ?: -1)
      .putInt("syncBlocked", s.blocked)
      .putInt("syncQuarantined", s.quarantined)
      .putBoolean("syncFailed", s.failed)
      .putString("syncPendingHeader", s.pendingHeader)
      .putString("syncRecoveryHash", s.recoveryHash)
      .commit()
  }
}

/** pending.bin: each sealed save as a 4-byte big-endian length, then its bytes. */
internal object PendingFile {
  fun append(file: ByteArray, blob: ByteArray): ByteArray = file + ByteBuffer.allocate(4).putInt(blob.size).array() + blob

  fun join(blobs: List<ByteArray>): ByteArray = blobs.fold(ByteArray(0), ::append)

  fun split(file: ByteArray): Pair<List<ByteArray>, Int> {
    val buf = ByteBuffer.wrap(file)
    val blobs = mutableListOf<ByteArray>()
    while (buf.remaining() >= 4) {
      val n = buf.int
      if (n < 0 || n > buf.remaining()) return blobs to 1
      blobs += ByteArray(n).also { buf.get(it) }
    }
    return blobs to if (buf.hasRemaining()) 1 else 0
  }
}

/** One unlock's pass over pending.bin: apply what opens, keep what may open later, count only what never will. */
internal object PendingPlan {
  sealed interface Open {
    class Plain(val bytes: ByteArray) : Open

    object Lost : Open

    object Retry : Open
  }

  class Plan(val apply: List<PendingSave>, val keep: List<ByteArray>, val lost: Int)

  fun of(file: ByteArray, open: (ByteArray) -> Open): Plan {
    val (blobs, damaged) = PendingFile.split(file)
    val apply = mutableListOf<PendingSave>()
    val keep = mutableListOf<ByteArray>()
    var lost = damaged
    for (blob in blobs) {
      when (val o = open(blob)) {
        is Open.Plain -> Saves.openAll(AlreadyOpen, listOf(o.bytes)).let { (saves, bad) ->
          apply += saves
          lost += bad
        }
        Open.Lost -> lost++
        Open.Retry -> keep += blob
      }
    }
    return Plan(apply, keep, lost)
  }

  private object AlreadyOpen : Sealer {
    override fun seal(plain: ByteArray): ByteArray = throw UnsupportedOperationException()

    override fun open(sealed: ByteArray): ByteArray = sealed
  }
}
