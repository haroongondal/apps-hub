package expo.modules.netlenscore

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** The Wake-on-LAN datagram may only ever leave for a private IPv4 address, so validation is the security gate. */
class UdpBroadcastTest {
  private val magic = List(102) { 0xFF }

  private fun rejected(ip: String, port: Int = 9, payload: List<Int> = magic) =
    assertNotNull("expected $ip:$port (${payload.size} bytes) to be rejected", UdpBroadcast.validate(ip, port, payload))

  private fun accepted(ip: String = "192.168.1.255", port: Int = 9, payload: List<Int> = magic) =
    assertNull(UdpBroadcast.validate(ip, port, payload))

  @Test
  fun `accepts private and link-local broadcast addresses`() {
    accepted("192.168.1.255")
    accepted("10.255.255.255")
    accepted("172.16.0.255")
    accepted("172.31.255.255")
    accepted("169.254.255.255")
  }

  @Test
  fun `rejects public, special and loopback addresses`() {
    rejected("8.8.8.8")
    rejected("255.255.255.255")
    rejected("0.0.0.0")
    rejected("127.0.0.1")
    rejected("224.0.0.1")
    rejected("172.15.0.1")
    rejected("172.32.0.1")
    rejected("192.169.1.1")
    rejected("169.253.1.1")
  }

  @Test
  fun `rejects anything that is not a strict dotted quad`() {
    rejected("192.168.1")
    rejected("192.168.01.255")
    rejected("192.168.1.256")
    rejected("192.168.1.255.1")
    rejected("192.168.1.255.")
    rejected("192..1.255")
    rejected("192.168.1.99999999999") // over-long octet must be an error text, never NumberFormatException
    rejected("0xC0.168.1.255")
    rejected("0300.168.1.255")
    rejected("3232235775")
    rejected("192.168.1.+5")
    rejected("192.168.1.-5")
    rejected(" 192.168.1.255")
    rejected("192.168.1.255 ")
    rejected("")
    rejected("example.com")
    rejected("::1")
    rejected("::ffff:192.168.1.255")
    rejected("192.168.１.255") // fullwidth digit
  }

  @Test
  fun `port must be 1 to 65535`() {
    accepted(port = 7)
    accepted(port = 9)
    accepted(port = 65535)
    accepted(port = 1)
    rejected("192.168.1.255", port = 0)
    rejected("192.168.1.255", port = 65536)
    rejected("192.168.1.255", port = -1)
  }

  @Test
  fun `payload must be 1 to 1024 bytes of 0 to 255`() {
    accepted(payload = List(102) { 0 })
    accepted(payload = List(1024) { 255 })
    rejected("192.168.1.255", payload = emptyList())
    rejected("192.168.1.255", payload = List(1025) { 0 })
    rejected("192.168.1.255", payload = listOf(1, 256))
    rejected("192.168.1.255", payload = listOf(-1, 1))
  }
}
