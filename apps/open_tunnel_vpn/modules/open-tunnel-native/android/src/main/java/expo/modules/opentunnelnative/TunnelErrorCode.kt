package expo.modules.opentunnelnative

/**
 * Status-event error-code strings shared with the TS contract
 * (`OPEN_TUNNEL_ERROR_CODES`, OpenTunnelNativeModule.ts). Keeping the
 * strings in one Kotlin object lets the app engines emit the exact TS
 * value without re-typing it (a typo here would silently break the JS
 * auto-jump to another relay).
 */
object TunnelErrorCode {
  const val AUTH_FAILED = "ERR_AUTH_FAILED"
}
