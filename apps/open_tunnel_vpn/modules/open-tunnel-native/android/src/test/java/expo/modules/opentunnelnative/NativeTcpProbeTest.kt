package expo.modules.opentunnelnative

import java.net.ServerSocket
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class NativeTcpProbeTest {

  @Test
  fun openRelayPortIsMeasured() {
    ServerSocket(0).use { server ->
      assertNotNull(NativeTcpProbe.connect("127.0.0.1", server.localPort, 1000))
    }
  }

  @Test
  fun refusedRelayPortCountsAsDown() {
    val closedPort = ServerSocket(0).use { it.localPort }
    assertNull(NativeTcpProbe.connect("127.0.0.1", closedPort, 1000))
  }
}
