package expo.modules.strongroomvault.android

import org.junit.Assert.assertEquals
import org.junit.Test

class ExpiryShareTest {
  @Test fun noIndexIsWrittenOnceTheSwitchIsOff() {
    var writes = 0
    ExpiryShare.writeIfStillOn({ false }, { writes++ }, {})
    assertEquals(0, writes)
  }

  @Test fun theIndexIsWrittenWhileTheSwitchIsOn() {
    var writes = 0
    ExpiryShare.writeIfStillOn({ true }, { writes++ }, {})
    assertEquals(1, writes)
  }

  @Test fun aFailedWriteDeletesTheIndex() {
    var discarded = 0
    ExpiryShare.writeIfStillOn({ true }, { error("disk full") }, { discarded++ })
    assertEquals(1, discarded)
  }
}
