package expo.modules.netlenscore

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM tests for the name-lookup transports (udpRequest, tcpFetch) over real loopback sockets. */
class NameProbesTest {
  private val loopback = InetAddress.getByName("127.0.0.1")

  /** Echoes the first datagram it gets back to its sender. */
  private fun echoServer(): DatagramSocket {
    val server = DatagramSocket(0, loopback)
    thread(isDaemon = true) {
      runCatching {
        val buf = ByteArray(512)
        val packet = DatagramPacket(buf, buf.size)
        server.receive(packet)
        server.send(DatagramPacket(packet.data, packet.length, packet.address, packet.port))
      }
    }
    return server
  }

  @Test
  fun `udpRequest returns the reply from a loopback echo`() = runBlocking {
    val server = echoServer()
    try {
      val payload = byteArrayOf(1, 2, 3, 4)
      val reply = NameProbes.udpRequest("127.0.0.1", server.localPort, payload, 1000)
      assertNotNull(reply)
      assertArrayEquals(payload, reply)
    } finally {
      server.close()
    }
  }

  @Test
  fun `udpRequest returns null when nothing answers within the timeout`() = runBlocking {
    val idle = DatagramSocket(0, loopback) // bound but never reads, so no reply (and no ICMP refusal)
    try {
      val started = System.currentTimeMillis()
      val reply = NameProbes.udpRequest("127.0.0.1", idle.localPort, byteArrayOf(9), 200)
      assertNull(reply)
      assertTrue("took ${System.currentTimeMillis() - started} ms", System.currentTimeMillis() - started < 1000)
    } finally {
      idle.close()
    }
  }

  @Test
  fun `udpRequest still sends when bind throws`() = runBlocking {
    val server = echoServer()
    try {
      val payload = byteArrayOf(7, 8)
      val reply = NameProbes.udpRequest(
        "127.0.0.1", server.localPort, payload, 1000,
        bind = { throw SecurityException("EPERM") },
      )
      assertArrayEquals(payload, reply)
    } finally {
      server.close()
    }
  }

  @Test
  fun `udpRequest ignores datagrams from another sender and keeps waiting`() = runBlocking {
    val server = DatagramSocket(0, loopback)
    val stranger = DatagramSocket(0, loopback)
    val answer = byteArrayOf(5, 5)
    thread(isDaemon = true) {
      runCatching {
        val packet = DatagramPacket(ByteArray(64), 64)
        server.receive(packet)
        // A different source port first: it must be dropped, not returned.
        stranger.send(DatagramPacket(byteArrayOf(66), 1, packet.address, packet.port))
        Thread.sleep(50)
        server.send(DatagramPacket(answer, answer.size, packet.address, packet.port))
      }
    }
    try {
      assertArrayEquals(answer, NameProbes.udpRequest("127.0.0.1", server.localPort, byteArrayOf(1), 1000))
    } finally {
      server.close()
      stranger.close()
    }
  }

  @Test
  fun `tcpFetch caps at maxBytes`() = runBlocking {
    val server = ServerSocket(0, 1, loopback)
    thread(isDaemon = true) {
      runCatching {
        server.accept().use { it.getOutputStream().write("a".repeat(100).toByteArray()) }
      }
    }
    try {
      assertEquals("aaaaaaaaaa", NameProbes.tcpFetch("127.0.0.1", server.localPort, "GET / HTTP/1.0\r\n\r\n", 1000, 10))
    } finally {
      server.close()
    }
  }

  @Test
  fun `tcpFetch returns null when the connection is refused`() = runBlocking {
    val closedPort = ServerSocket(0, 1, loopback).use { it.localPort }
    assertNull(NameProbes.tcpFetch("127.0.0.1", closedPort, "x", 500, 100))
  }
}
