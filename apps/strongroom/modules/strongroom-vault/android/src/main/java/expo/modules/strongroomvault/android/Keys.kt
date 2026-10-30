package expo.modules.strongroomvault.android

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.fragment.app.FragmentActivity
import expo.modules.strongroomvault.core.Sealer
import java.security.KeyStore
import java.security.UnrecoverableKeyException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val KEYSTORE = "AndroidKeyStore"
private const val GCM = "AES/GCM/NoPadding"
internal const val IV_BYTES = 12
private const val TAG_BITS = 128

private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

private fun stored(alias: String): SecretKey? = keyStore().getKey(alias, null) as SecretKey?

private fun aesGcm(alias: String) =
  KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
    .setKeySize(256)
    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)

private fun generate(spec: KeyGenParameterSpec): SecretKey =
  KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).apply { init(spec) }.generateKey()

/** Seals the match index and pending saves (IV then ciphertext); opens only while the phone itself is unlocked. */
internal object DeviceKey : Sealer {
  private const val ALIAS = "strongroom-device"

  private fun create() = generate(aesGcm(ALIAS).setUnlockedDeviceRequired(true).build())

  override fun seal(plain: ByteArray): ByteArray {
    val c = Cipher.getInstance(GCM)
    try {
      c.init(Cipher.ENCRYPT_MODE, stored(ALIAS) ?: create())
    } catch (e: KeyPermanentlyInvalidatedException) {
      c.init(Cipher.ENCRYPT_MODE, create()) // a key that has gone is replaced; what it sealed is counted as lost
    } catch (e: UnrecoverableKeyException) {
      c.init(Cipher.ENCRYPT_MODE, create())
    }
    return c.iv + c.doFinal(plain)
  }

  override fun open(sealed: ByteArray): ByteArray? {
    if (sealed.size < IV_BYTES) return null
    return try {
      val key = stored(ALIAS) ?: return null
      Cipher.getInstance(GCM).run {
        init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, sealed, 0, IV_BYTES))
        doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES)
      }
    } catch (e: Exception) {
      null
    }
  }
}

internal object BiometricKey {
  private const val ALIAS = "strongroom-biometric"

  fun available(activity: FragmentActivity) =
    BiometricManager.from(activity).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

  fun encrypter(): Cipher {
    val spec = aesGcm(ALIAS)
      .setUserAuthenticationRequired(true)
      .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
      .setInvalidatedByBiometricEnrollment(true)
      .build()
    return Cipher.getInstance(GCM).apply { init(Cipher.ENCRYPT_MODE, generate(spec)) }
  }

  /** Null when the key is gone; throws KeyPermanentlyInvalidatedException after a new enrollment. */
  fun decrypter(iv: ByteArray): Cipher? {
    val key = stored(ALIAS) ?: return null
    return Cipher.getInstance(GCM).apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv)) }
  }

  fun delete() = keyStore().deleteEntry(ALIAS)

  fun prompt(activity: FragmentActivity, cipher: Cipher, title: String, negative: String, onDone: (Cipher?) -> Unit) {
    val info = BiometricPrompt.PromptInfo.Builder()
      .setTitle(title)
      .setNegativeButtonText(negative)
      .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
      .build()
    val callback = object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onDone(result.cryptoObject?.cipher)

      override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = onDone(null)
    }
    BiometricPrompt(activity, activity.mainExecutor, callback).authenticate(info, BiometricPrompt.CryptoObject(cipher))
  }
}
