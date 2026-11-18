package expo.modules.designmedia.core

import java.io.File
import java.security.MessageDigest
import kotlin.math.abs
import kotlin.math.max
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CleanupScoresTest {
  private val cases = Json.parseToJsonElement(fixtureText("gallery-cleanup/cases.json")).jsonObject

  private class Img(val argb: IntArray, val w: Int, val h: Int)

  // ImageIO is on the test JVM but not on the android.jar compile classpath, so call it by reflection.
  private fun read(file: String): Img {
    val img = Class.forName("javax.imageio.ImageIO").getMethod("read", File::class.java)
      .invoke(null, File(System.getProperty("fixtures.dir"), "gallery-cleanup/$file"))
    val w = img.javaClass.getMethod("getWidth").invoke(img) as Int
    val h = img.javaClass.getMethod("getHeight").invoke(img) as Int
    val argb = IntArray(w * h)
    val t = Int::class.javaPrimitiveType
    img.javaClass.getMethod("getRGB", t, t, t, t, IntArray::class.java, t, t).invoke(img, 0, 0, w, h, argb, 0, w)
    return Img(argb, w, h)
  }

  private fun close(a: Double, b: Double, rel: Double) = abs(a - b) <= rel * max(abs(a), abs(b))

  private fun sha256(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

  @Test
  fun matchesReferenceFixtures() {
    val all = cases.getValue("cases").jsonObject
    assertEquals(8, all.size)
    for ((name, c) in all) {
      val o = c.jsonObject
      val img = read(o.getValue("file").jsonPrimitive.content)
      assertEquals(name, o.getValue("w").jsonPrimitive.int, img.w)
      val g = grey(img.argb)
      assertEquals(name, o.getValue("grey_sha256").jsonPrimitive.content, sha256(g))
      assertEquals(name, o.getValue("dhash").jsonPrimitive.content, "%016x".format(dhash(g, img.w, img.h)))
      val b = o.getValue("brightness").jsonArray.map { it.jsonPrimitive.double }
      val got = brightness(g)
      assertTrue("$name mean", close(got[0], b[0], 1e-12))
      assertTrue("$name spread", close(got[1], b[1], 1e-12))
      val lap = o.getValue("laplacian_var").jsonPrimitive.content.toDouble()
      assertTrue("$name laplacian ${laplacianVar(g, img.w, img.h)} vs $lap", close(laplacianVar(g, img.w, img.h), lap, 1e-9))
    }
  }

  @Test
  fun oddGreyMatchesU8() {
    val expected = File(System.getProperty("fixtures.dir"), "gallery-cleanup/odd.u8").readBytes()
    assertArrayEquals(expected, grey(read("odd.png").argb))
  }

  @Test
  fun pairsAndAspect() {
    val all = cases.getValue("cases").jsonObject
    val hashes = all.mapValues { (_, c) ->
      val img = read(c.jsonObject.getValue("file").jsonPrimitive.content)
      dhash(grey(img.argb), img.w, img.h)
    }
    for (p in cases.getValue("pairs").jsonArray) {
      val o = p.jsonObject
      val a = o.getValue("a").jsonPrimitive.content
      val b = o.getValue("b").jsonPrimitive.content
      assertEquals("$a/$b", o.getValue("hamming").jsonPrimitive.int, hamming(hashes.getValue(a), hashes.getValue(b)))
    }
    for (p in cases.getValue("aspect").jsonArray) {
      val o = p.jsonObject
      val (w1, h1, w2, h2) = listOf("w1", "h1", "w2", "h2").map { o.getValue(it).jsonPrimitive.int }
      assertEquals("${w1}x$h1 vs ${w2}x$h2", o.getValue("close").jsonPrimitive.boolean, aspectClose(w1, h1, w2, h2))
    }
  }

  @Test
  fun thumb512SizeFollowsRef() {
    assertEquals(512 to 384, thumb512Size(4000, 3000))
    assertEquals(300 to 200, thumb512Size(300, 200))
    assertEquals(512 to 1, thumb512Size(5000, 3))
    assertEquals(256 to 512, thumb512Size(511, 1024))
  }

  @Test
  fun scoresOfStoresFloatsAndInputSize() {
    val img = read("noisy.png")
    val g = grey(img.argb)
    val s = scoresOf(img.argb, img.w, img.h)
    assertEquals(dhash(g, img.w, img.h), s.dhash)
    assertEquals(brightness(g)[0].toFloat(), s.mean, 0f)
    assertEquals(brightness(g)[1].toFloat(), s.spread, 0f)
    assertEquals(laplacianVar(g, img.w, img.h).toFloat(), s.laplacian, 0f)
    assertEquals(300, s.width)
    assertEquals(200, s.height)
  }

  @Test
  fun tinyImagesDoNotCrash() {
    val s = scoresOf(intArrayOf(0xFF102030.toInt()), 1, 1)
    assertEquals(0f, s.laplacian, 0f)
    assertEquals(0L, s.dhash)
    assertEquals(0f, scoresOf(IntArray(6), 2, 3).laplacian, 0f)
  }
}
