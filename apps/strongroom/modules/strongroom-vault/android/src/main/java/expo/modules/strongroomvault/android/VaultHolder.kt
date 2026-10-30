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

  @Volatile private var vault: Vault? = null
  @Volatile private var app: Context? = null
  @Volatile private var prompt: BiometricPrompt? = null

  @Volatile internal var pendingImport: ImportResult? = null

  private val timer = Executors.newSingleThreadScheduledExecutor { Thread(it, "strongroom-autolock").apply { isDaemon = true } }
  private var expiry: ScheduledFuture<*>? = null
  private val pendingFile = Any()
  private val indexFile = Any()
  private val main = Handler(Looper.getMainLooper())

  internal fun prefs(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences("strongroom", Context.MODE_PRIVATE)

  fun get(context: Context): Vault = vault ?: synchronized(this) {
    vault ?: Vault(SqliteRecordStore(context.applicationContext), System::currentTimeMillis, SystemClock::elapsedRealtime).also {
      it.autoLockMinutes = prefs(context).getInt(AUTO_LOCK, 5).takeIf(LockPolicy::validTimeout) ?: 5
      app = context.applicationContext
      vault = it
    }
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

  fun refreshIndex(context: Context) {
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
    afterUnlock(context, byPassword = true)
    return true
  }

  fun biometricUnlock(activity: FragmentActivity, onResult: (Boolean) -> Unit) {
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
    prompt = BiometricKey.prompt(activity, cipher, "Unlock Strongroom", "Use master password") { done ->
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

  internal fun afterUnlock(context: Context, byPassword: Boolean) {
    if (byPassword) {
      val boot = bootCount(context)
      prefs(context).edit().apply { if (boot == null) remove(PASSWORD_BOOT) else putInt(PASSWORD_BOOT, boot) }.commit()
    }
    applyPending(context)
    refreshIndex(context)
    scheduleLock()
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
