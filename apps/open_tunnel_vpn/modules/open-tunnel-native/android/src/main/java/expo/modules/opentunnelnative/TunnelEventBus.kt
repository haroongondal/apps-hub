package expo.modules.opentunnelnative

import java.util.concurrent.CopyOnWriteArrayList

/**
 * Same-process relay between the app-package VpnService and this Expo
 * module. The Gradle dependency points one way — the app may import module
 * classes, never the reverse — so the app-package service posts here and
 * the module (the only Expo event emitter) pushes to JS. Each listener owns
 * its own marshalling; the module delivers on the main thread.
 */
object TunnelEventBus {

  /**
   * Payload keys are part of the JS contract (plan §4.1):
   * `{state, message?, code?}` and `{bytesIn, bytesOut, connectedDurationSec}`.
   * `code` carries the typed failure code (e.g. `ERR_AUTH_FAILED`) only when
   * the engine failure has one; it is null otherwise and the emitted event
   * omits the key.
   */
  interface Listener {
    fun onStatus(state: String, message: String?, code: String?)
    fun onTraffic(bytesIn: Long, bytesOut: Long, connectedDurationSec: Long)
  }

  private val listeners = CopyOnWriteArrayList<Listener>()

  fun add(listener: Listener) {
    listeners.add(listener)
  }

  fun remove(listener: Listener) {
    listeners.remove(listener)
  }

  fun postStatus(state: String, message: String?, code: String? = null) {
    for (listener in listeners) listener.onStatus(state, message, code)
  }

  fun postTraffic(bytesIn: Long, bytesOut: Long, connectedDurationSec: Long) {
    for (listener in listeners) {
      listener.onTraffic(bytesIn, bytesOut, connectedDurationSec)
    }
  }
}
