package expo.modules.strongroomvault.android

import android.nfc.cardemulation.HostApduService
import android.os.Bundle

// Answers an untrusted NFC reader. No logging: the payload and the APDUs are the pass code.
class StrongroomTagService : HostApduService() {
  override fun processCommandApdu(commandApdu: ByteArray?, extras: Bundle?): ByteArray =
    Presenting.process(commandApdu ?: ByteArray(0))

  // Not disarmed here: a reader may reselect, and the 60 s limit in Type4Tag is never extended.
  override fun onDeactivated(reason: Int) = Unit
}
