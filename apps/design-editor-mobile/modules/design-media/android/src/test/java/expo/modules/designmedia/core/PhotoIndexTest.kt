package expo.modules.designmedia.core

import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.file.Files
import java.util.Random
import kotlin.math.sqrt
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PhotoIndexTest {
  private fun tmp(): File = Files.createTempDirectory("photoindex").toFile().resolve("index.bin")

  private fun row(id: Long, modified: Long = 10, size: Long = 20, fill: Int = id.toInt()) =
    PhotoRow(PhotoKey(id, modified, size), ByteArray(512) { (fill + it).toByte() })

  private fun unitAxis(i: Int) = FloatArray(512).also { it[i] = 1f }

  private fun randomUnit(r: Random): FloatArray {
    val v = FloatArray(512) { r.nextGaussian().toFloat() }
    val n = sqrt(v.sumOf { (it * it).toDouble() }).toFloat()
    return FloatArray(512) { v[it] / n }
  }

  @Test
  fun roundTripAndTornTail() {
    val f = tmp()
    val rows = (1L..5L).map { row(it) }
    PhotoIndexFile.append(f, rows.take(3))
    PhotoIndexFile.append(f, rows.drop(3))
    FileOutputStream(f, true).use { it.write(ByteArray(100) { 7 }) }
    val back = PhotoIndexFile.read(f)
    assertEquals(5, back.size)
    rows.zip(back).forEach { (a, b) ->
      assertEquals(a.key, b.key)
      assertArrayEquals(a.vec, b.vec)
    }
  }

  @Test
  fun missingFileMeansEmpty() {
    assertTrue(PhotoIndexFile.read(tmp()).isEmpty())
  }

  @Test
  fun versionMismatchMeansEmpty() {
    val f = tmp()
    PhotoIndexFile.append(f, listOf(row(1)))
    val bytes = f.readBytes()
    ByteBuffer.wrap(bytes).putInt(8, 0)
    FileOutputStream(f).use { it.write(bytes) }
    assertTrue(PhotoIndexFile.read(f).isEmpty())
  }

  @Test
  fun rewriteReplacesTheContent() {
    val f = tmp()
    PhotoIndexFile.append(f, (1L..4L).map { row(it) })
    PhotoIndexFile.rewrite(f, listOf(row(9)))
    assertEquals(listOf(PhotoKey(9, 10, 20)), PhotoIndexFile.read(f).map { it.key })
  }

  @Test
  fun diffKeepsUnchangedDropsGoneEmbedsNewAndChanged() {
    val gallery = listOf(PhotoKey(1, 10, 20), PhotoKey(2, 99, 20), PhotoKey(4, 10, 20))
    val d = diff(gallery, listOf(row(1), row(2), row(3)))
    assertEquals(listOf(1L), d.keep.map { it.key.id })
    assertEquals(listOf(2L, 4L), d.toEmbed.map { it.id })
  }

  @Test
  fun emptyGalleryDropsEverything() {
    val d = diff(emptyList(), listOf(row(1), row(2)))
    assertTrue(d.keep.isEmpty())
    assertTrue(d.toEmbed.isEmpty())
  }

  @Test
  fun quantizeNormalisesAndClamps() {
    val q = quantize(FloatArray(512).also { it[0] = 5f })
    assertEquals(127, q[0].toInt())
    assertEquals(0, q[1].toInt())
    val neg = quantize(FloatArray(512).also { it[3] = -0.5f })
    assertEquals(-127, neg[3].toInt())
  }

  @Test
  fun int8RankingMatchesFloat() {
    val r = Random(1)
    val vecs = List(2000) { randomUnit(r) }
    val rows = vecs.mapIndexed { i, v -> PhotoRow(PhotoKey(i.toLong(), 0, 0), quantize(v)) }
    fun floatTop(q: FloatArray, n: Int) =
      vecs.indices.sortedByDescending { i -> vecs[i].indices.sumOf { (vecs[i][it] * q[it]).toDouble() } }.take(n).map { it.toLong() }
    // Random 512-d vectors are nearly equidistant, so only the set is stable; the intended photo (a noisy copy) must stay first.
    var overlap = 0
    var first = 0
    repeat(50) { n ->
      val q = randomUnit(r)
      overlap += rank(rows, q, 5, -1f).count { it in floatTop(q, 5) }
      val noisy = FloatArray(512) { vecs[n][it] + 0.5f * randomUnit(r)[it] }
      if (rank(rows, noisy, 1, -1f) == floatTop(noisy, 1)) first++
    }
    assertTrue("top-5 overlap $overlap/250", overlap >= 250 * 0.85)
    assertTrue("top-1 agreement $first/50", first >= 49)
  }

  @Test
  fun floorDropsWeakMatchesAndLimitCaps() {
    val rows = (0..2).map { PhotoRow(PhotoKey(it.toLong(), 0, 0), quantize(unitAxis(it))) }
    assertTrue(rank(rows, unitAxis(3), 10, 0.25f).isEmpty())
    assertEquals(listOf(1L), rank(rows, unitAxis(1), 10, 0.25f))
    assertEquals(2, rank(rows, FloatArray(512) { 1f }, 2, -1f).size)
  }

  @Test
  fun tiesKeepIndexOrder() {
    val rows = (5L..7L).map { PhotoRow(PhotoKey(it, 0, 0), quantize(unitAxis(0))) }
    assertEquals(listOf(5L, 6L, 7L), rank(rows, unitAxis(0), 10, 0f))
  }

  @Test
  fun backOffRule() {
    assertTrue(shouldPause(19, false, 0))
    assertFalse(shouldPause(19, true, 0))
    assertFalse(shouldPause(20, false, 0))
    assertTrue(shouldPause(80, true, 3))
    assertFalse(shouldPause(80, false, 2))
  }
}
