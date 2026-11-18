package expo.modules.clipboardcore.core

object CaptureGate {
  // A deleted clip stays dismissed only against the open-the-app read; a copy event is deliberate, so it saves again.
  fun skip(via: String, fingerprint: Int, last: Int?, dismissed: Int?): Boolean =
    fingerprint == last || (via == "app" && fingerprint == dismissed)
}
