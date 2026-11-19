package expo.modules.haloengine.core

object ChargeWake {
  // Same sweep as AodContent's plug-in flash: the plug-in broadcast is gone by the time a charge wake shows the screen, so it is replayed.
  val SWEEP = FlashDecision("halo:charging", DotKind.CHARGING.colour, "sweep", 1, 1_800L)

  fun wanted(plugIn: Boolean, screenOn: Boolean, aodShowing: Boolean, aodEnabled: Boolean, wakeOnCharge: Boolean) =
    plugIn && !screenOn && !aodShowing && aodEnabled && wakeOnCharge
}

/** proximityNear null means no reading (no sensor, or none before the timeout); it counts as a pocket, so no wake. */
fun shouldWakeForCharge(
  screenOn: Boolean,
  aodShowing: Boolean,
  aodEnabled: Boolean,
  wakeOnCharge: Boolean,
  proximityNear: Boolean?,
  plugIn: Boolean,
): Boolean = ChargeWake.wanted(plugIn, screenOn, aodShowing, aodEnabled, wakeOnCharge) && proximityNear == false
