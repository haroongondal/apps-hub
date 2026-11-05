package expo.modules.strongroomvault.android

import expo.modules.strongroomvault.core.AccountCreate
import expo.modules.strongroomvault.core.PushRequest
import expo.modules.strongroomvault.core.PushResponse
import expo.modules.strongroomvault.core.SyncAuthError
import expo.modules.strongroomvault.core.SyncHttpError
import expo.modules.strongroomvault.core.SyncOfflineError
import expo.modules.strongroomvault.core.SyncWire
import expo.modules.strongroomvault.core.Upsert
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.file.Files
import java.security.KeyStore
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import kotlin.concurrent.thread

// A real TLS socket on 127.0.0.1 with a throwaway certificate the client trusts for this test only.
class HttpSyncTransportTest {
  private val token = ByteArray(32) { it.toByte() }

  private fun tls(): Pair<SSLContext, SSLContext> {
    val dir = Files.createTempDirectory("tls").toFile()
    val store = File(dir, "t.p12")
    val keytool = File(System.getProperty("java.home"), "bin/keytool").path
    val args = listOf(
      keytool, "-genkeypair", "-alias", "t", "-keyalg", "EC", "-groupname", "secp256r1", "-dname", "CN=127.0.0.1",
      "-ext", "SAN=ip:127.0.0.1", "-validity", "2", "-storetype", "PKCS12", "-keystore", store.path, "-storepass", "changeit",
    )
    assertEquals(0, ProcessBuilder(args).redirectErrorStream(true).start().also { it.inputStream.readAllBytes() }.waitFor())
    val ks = KeyStore.getInstance("PKCS12").apply { store.inputStream().use { load(it, "changeit".toCharArray()) } }
    dir.deleteRecursively()
    val server = SSLContext.getInstance("TLS").apply {
      init(KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(ks, "changeit".toCharArray()) }.keyManagers, null, null)
    }
    val client = SSLContext.getInstance("TLS").apply {
      init(null, TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(ks) }.trustManagers, null)
    }
    return server to client
  }

  private fun serve(socket: Socket, reply: String): String = socket.use { s ->
    val input = s.getInputStream()
    val head = ByteArrayOutputStream()
    while (!head.toString(Charsets.ISO_8859_1).endsWith("\r\n\r\n")) head.write(input.read())
    val lines = head.toString(Charsets.ISO_8859_1).trim().split("\r\n")
    val headers = lines.drop(1).associate { it.substringBefore(':').lowercase() to it.substringAfter(':').trim() }
    val body = String(input.readNBytes(headers["content-length"]?.toInt() ?: 0), Charsets.UTF_8)
    s.getOutputStream().apply { write(reply.toByteArray(Charsets.UTF_8)) }.flush()
    listOf(lines[0], headers["authorization"], headers["content-type"], body).joinToString(" | ")
  }

  private fun reply(status: String, body: String = "", extra: String = "") =
    "HTTP/1.1 $status\r\nContent-Type: application/json\r\nContent-Length: ${body.toByteArray().size}\r\n${extra}Connection: close\r\n\r\n$body"

  @Test fun httpTransportSpeaksTheProtocol() {
    val (serverTls, clientTls) = tls()
    val listener = serverTls.serverSocketFactory.createServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
    val replies = listOf(
      reply("200 OK", """{"header":"h","headerRev":3,"records":[],"latestRev":9,"more":false}"""),
      reply("200 OK", """{"revs":[{"id":"a","rev":10}],"latestRev":10}"""),
      reply("200 OK", """{"headerRev":1}"""),
      reply("401 Unauthorized", """{"error":"no"}"""),
      reply("302 Found", "", "Location: https://127.0.0.1:${listener.localPort}/elsewhere\r\n"),
    )
    val seen = ArrayList<String>()
    val server = thread(isDaemon = true) { for (r in replies) seen += serve(listener.accept(), r) }
    val previous = HttpsURLConnection.getDefaultSSLSocketFactory()
    HttpsURLConnection.setDefaultSSLSocketFactory(clientTls.socketFactory)
    try {
      val t = HttpSyncTransport("https://127.0.0.1:${listener.localPort}")
      assertEquals(9L, t.pull(token, 5).latestRev)
      val push = PushRequest(listOf(Upsert("a", 0, "AAAA")))
      assertEquals(PushResponse(listOf("a" to 10L), 10), t.push(token, push))
      assertEquals(1L, t.putAccount("the-setup-token", AccountCreate("h", "l", "r", "d")))
      assertThrows(SyncAuthError::class.java) { t.pull(token, 0) }
      assertEquals(302, assertThrows(SyncHttpError::class.java) { t.pull(token, 0) }.status) // never followed
      server.join(5_000)
      val bearer = "Bearer " + SyncWire.toBase64(token)
      assertEquals(
        listOf(
          "GET /v1/records?since=5&limit=100 HTTP/1.1 | $bearer | null | ",
          "POST /v1/records HTTP/1.1 | $bearer | application/json | ${SyncWire.toJson(push)}",
          "PUT /v1/account HTTP/1.1 | Bearer the-setup-token | application/json | ${SyncWire.toJson(AccountCreate("h", "l", "r", "d"))}",
          "GET /v1/records?since=0&limit=100 HTTP/1.1 | $bearer | null | ",
          "GET /v1/records?since=0&limit=100 HTTP/1.1 | $bearer | null | ",
        ),
        seen,
      )
      val closed = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { it.localPort }
      assertThrows(SyncOfflineError::class.java) { HttpSyncTransport("https://127.0.0.1:$closed").pull(token, 0) }
    } finally {
      HttpsURLConnection.setDefaultSSLSocketFactory(previous)
      listener.close()
    }
  }
}
