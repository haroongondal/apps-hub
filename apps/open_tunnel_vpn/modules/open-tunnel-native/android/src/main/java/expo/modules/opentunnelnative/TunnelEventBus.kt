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
   * `{state, message?}` and `{bytesIn, bytesOut, connectedDurationSec}`.
   */
  interface Listener {
    fun onStatus(state: String, message: String?)
    fun onTraffic(bytesIn: Long, bytesOut: Long, connectedDurationSec: Long)
  }

  private val listeners = CopyOnWriteArrayList<Listener>()

  fun add(listener: Listener) {
    listeners.add(listener)
  }

  fun remove(listener: Listener) {
    listeners.remove(listener)
  }

  fun postStatus(state: String, message: String?) {
    for (listener in listeners) listener.onStatus(state, message)
  }

  fun postTraffic(bytesIn: Long, bytesOut: Long, connectedDurationSec: Long) {
    for (listener in listeners) {
      listener.onTraffic(bytesIn, bytesOut, connectedDurationSec)
    }
  }
}
