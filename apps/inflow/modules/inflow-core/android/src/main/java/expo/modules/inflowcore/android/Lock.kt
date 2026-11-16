package expo.modules.inflowcore.android

import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

object Lock {
  const val NOT_SET_UP = "Set up a fingerprint or screen lock in phone settings, then try again."
  const val FAILED = "Inflow couldn't check your fingerprint. Try again."

  suspend fun authenticate(activity: FragmentActivity): Pair<Boolean, String?> = withContext(Dispatchers.Main) {
    suspendCancellableCoroutine { cont ->
      val callback = object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          if (cont.isActive) cont.resume(true to null)
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
          if (cont.isActive) cont.resume(false to messageFor(errorCode))
        }
      }
      val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
      cont.invokeOnCancellation { prompt.cancelAuthentication() }
      val info = BiometricPrompt.PromptInfo.Builder()
        .setTitle("Unlock Inflow")
        .setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL)
        .build()
      prompt.authenticate(info)
    }
  }

  fun messageFor(errorCode: Int): String? = when (errorCode) {
    BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON -> null
    BiometricPrompt.ERROR_NO_BIOMETRICS, BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL -> NOT_SET_UP
    else -> FAILED
  }
}
