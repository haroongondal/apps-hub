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

  // Android resets an app's interface when the same app establishes another, so an engine started after the block may have replaced it.
  fun reusesBlock(held: Boolean, engineStartedSince: Boolean): Boolean = held && !engineStartedSince

  /** What a block attempt left behind; [closeOld] and [publish] are what OpenTunnelVpnService.holdBlock does next. */
  data class BlockOutcome(val held: Boolean, val closeOld: Boolean, val publish: Boolean?)

  // Known edge, pinned by KillSwitchTest: a failed establish() still closes the old block. holdBlock only gets here when no live block can be
  // reused, i.e. an engine started since (Android then replaced the block, so the old fd is dead) or there was none. If that engine failed before
  // its own establish, the old interface was still alive and this closes it. Keeping it would instead claim a block that an established engine
  // already replaced, so the honest report was kept: not blocking. failStart, RELEASE and the implicit start then tear the service down; startTunnel ignores the result and goes on to start the engine.
  fun afterEstablish(hadBlock: Boolean, established: Boolean): BlockOutcome =
    BlockOutcome(held = established, closeOld = true, publish = if (established) true else if (hadBlock) false else null)
}
