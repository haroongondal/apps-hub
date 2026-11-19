package expo.modules.aihubcore.android

import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class OkHttpTransportTest {
  private val transport = OkHttpTransport()

  private fun post(port: Int) = transport.post("http://127.0.0.1:$port/v1/chat", emptyMap(), """{"q":1}""".toByteArray(), "application/json")

  private fun readRequest(input: InputStream) {
    val head = StringBuilder()
    while (!head.endsWith("\r\n\r\n")) head.append(input.read().takeIf { it >= 0 }?.toChar() ?: throw IOException("closed"))
    val length = Regex("(?i)content-length: (\\d+)").find(head)!!.groupValues[1].toInt()
    repeat(length) { input.read() }
  }

  // Serves each request in order; `drop` lists the request numbers answered by closing the connection instead.
  private fun server(drop: Set<Int>, block: (port: Int, accepted: AtomicInteger) -> Unit) {
    ServerSocket(0, 50, InetAddress.getLoopbackAddress()).use { server ->
      val accepted = AtomicInteger()
      val requests = AtomicInteger()
      thread(isDaemon = true) {
        while (true) {
          val s: Socket = try { server.accept() } catch (e: IOException) { break }
          accepted.incrementAndGet()
          s.use {
            while (true) {
              try { readRequest(it.getInputStream()) } catch (e: IOException) { break }
              if (requests.incrementAndGet() in drop) break
              it.getOutputStream().apply { write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}".toByteArray()); flush() }
            }
          }
        }
      }
      block(server.localPort, accepted)
    }
  }

  @Test fun aRefusedConnectionIsAPlainIOExceptionSoItMayBeResent() {
    val port = ServerSocket(0, 0, InetAddress.getLoopbackAddress()).use { it.localPort }
    val e = assertThrows(IOException::class.java) { post(port) }
    assertFalse(e.toString(), e is SocketTimeoutException)
  }

  @Test fun aConnectionDroppedAfterTheRequestWasSentCountsAsATimeout() = server(drop = setOf(1)) { port, accepted ->
    assertThrows(SocketTimeoutException::class.java) { post(port) }
    assertEquals(1, accepted.get())
  }

  @Test fun aPooledConnectionThatDropsIsNotSilentlyResent() = server(drop = setOf(2)) { port, accepted ->
    assertEquals(200, post(port).code)
    assertThrows(SocketTimeoutException::class.java) { post(port) }
    assertEquals(1, accepted.get())
  }
}
