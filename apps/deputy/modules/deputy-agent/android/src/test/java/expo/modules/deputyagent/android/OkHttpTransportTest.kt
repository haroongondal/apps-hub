package expo.modules.deputyagent.android

import java.io.IOException
import java.net.ServerSocket
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertTrue
import org.junit.Test

class OkHttpTransportTest {
  @Test fun aBodyCutAfterTheHeadersFailsTheCallInsteadOfHanging() = runBlocking {
    ServerSocket(0).use { server ->
      thread {
        server.accept().use { s ->
          s.getInputStream().read(ByteArray(4096))
          s.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n{\"a\"".toByteArray())
          s.getOutputStream().flush()
        }
      }
      val failure = runCatching { withTimeout(10_000) { OkHttpTransport.post("http://127.0.0.1:${server.localPort}/", emptyMap(), "{}") } }.exceptionOrNull()
      assertTrue("expected an IOException, got $failure", failure is IOException)
    }
  }
}
