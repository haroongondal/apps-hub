package expo.modules.opentunnelnative

enum class KillSwitchEvent { START, CONNECTED, ENGINE_ENDED, ENGINE_REVOKED, USER_STOP, BLOCK_REVOKED }

object KillSwitch {
  // Armed only after a tunnel reached connected, so a dead relay on a first connect never blocks the internet.
  fun next(armed: Boolean, enabled: Boolean, event: KillSwitchEvent): Boolean =
    when (event) {
      KillSwitchEvent.START -> armed && enabled
      KillSwitchEvent.CONNECTED -> enabled
      KillSwitchEvent.ENGINE_ENDED -> armed
      KillSwitchEvent.ENGINE_REVOKED, KillSwitchEvent.USER_STOP, KillSwitchEvent.BLOCK_REVOKED -> false
    }

  // ics-openvpn keeps its interface while reasserting (tun reopen is NOACTION or OPEN_BEFORE_CLOSE); a block would replace it.
  fun holdsBlock(armed: Boolean, status: String): Boolean =
    armed && status != TunnelStatus.CONNECTED && status != TunnelStatus.REASSERTING
}
