package expo.modules.strongroomvault.android

import android.security.keystore.KeyPermanentlyInvalidatedException
import android.util.AtomicFile
import expo.modules.strongroomvault.core.KEY_LOST
import expo.modules.strongroomvault.core.SyncSecret
import expo.modules.strongroomvault.core.SyncSecrets
import java.io.File
import java.io.FileNotFoundException
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec

internal class SyncKey(val alias: String, val unlockedDeviceRequired: Boolean) {
  private fun create() = generate(aesGcm(alias).setUnlockedDeviceRequired(unlockedDeviceRequired).build())

  // Never a silent new key under this alias: the other secrets it sealed would stop opening. Only an owner's sign-in starts over (SyncSession.storeAll).
  fun seal(plain: ByteArray): ByteArray {
    val c = Cipher.getInstance(GCM)
    try {
      c.init(Cipher.ENCRYPT_MODE, stored(alias) ?: create())
    } catch (e: KeyPermanentlyInvalidatedException) {
      throw IllegalStateException(KEY_LOST, e)
    }
    return c.iv + c.doFinal(plain)
  }

  fun delete() = keyStore().deleteEntry(alias)

  /** Null when the key or the blob is gone for good; any other Keystore failure (the phone locked) throws, so the caller tries again later. */
  fun open(sealed: ByteArray): ByteArray? {
    if (sealed.size < IV_BYTES + TAG_BITS / 8) return null
    val key = stored(alias) ?: return null
    return try {
      val c = Cipher.getInstance(GCM)
      c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, sealed, 0, IV_BYTES))
      c.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES)
    } catch (e: AEADBadTagException) {
      null
    } catch (e: KeyPermanentlyInvalidatedException) {
      null
    }
  }
}

internal object SyncKeys {
  // DESIGN §10: the account key and login token open only while the phone is unlocked, like the match index; the read token doesn't need that, so the job can download while the phone is locked.
  val ACCOUNT = SyncKey("strongroom-sync-account", unlockedDeviceRequired = true)
  val READ = SyncKey("strongroom-sync-read", unlockedDeviceRequired = false)

  fun keyFor(s: SyncSecret) = if (s == SyncSecret.READ_TOKEN) READ else ACCOUNT
}

internal class KeystoreSyncSecrets(private val dir: File) : SyncSecrets {
  private fun file(s: SyncSecret) = AtomicFile(File(dir, "sync-${s.name.lowercase()}.bin"))

  override fun get(s: SyncSecret): ByteArray? {
    val sealed = try {
      file(s).readFully()
    } catch (e: FileNotFoundException) {
      return null
    }
    return SyncKeys.keyFor(s).open(sealed)
  }

  override fun put(s: SyncSecret, value: ByteArray) {
    val f = file(s)
    val out = f.startWrite()
    try {
      out.write(SyncKeys.keyFor(s).seal(value))
      f.finishWrite(out)
    } catch (e: Exception) {
      f.failWrite(out)
      throw e
    }
  }

  override fun delete(s: SyncSecret) = file(s).delete()

  override fun reset() {
    SyncSecret.entries.forEach(::delete)
    SyncKeys.ACCOUNT.delete()
    SyncKeys.READ.delete()
  }
}
