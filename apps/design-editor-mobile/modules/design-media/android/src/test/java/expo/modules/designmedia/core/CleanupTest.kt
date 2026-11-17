package expo.modules.designmedia.core

import java.util.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CleanupTest {
  private val day = 86_400_000L
  private val min = 60_000L

  // Unrelated by default: one-hot vector (cosine 0), random dhash, a day apart.
  private fun photo(
    id: Long, dhash: Long = Random(id).nextLong(), w: Int = 300, h: Int = 200, lap: Float = 500f,
    mean: Float = 0.5f, spread: Float = 0.2f, vec: ByteArray = oneHot(id), bytes: Long = 1000, takenAt: Long = id * day,
    pixels: Long = 12_000_000, path: String? = "DCIM/Camera/",
  ) = CleanupPhoto(id, vec, PhotoScores(dhash, mean, spread, lap, w, h), bytes, takenAt, pixels, path)

  private fun oneHot(id: Long) = ByteArray(512).also { it[(id % 512).toInt()] = 100 }
  private fun vec2(a: Int, b: Int) = ByteArray(512).also { it[0] = a.toByte(); it[1] = b.toByte() }
  private fun hex(s: String) = java.lang.Long.parseUnsignedLong(s, 16)

  private fun groups(ps: List<CleanupPhoto>, dismissed: Set<Pair<CleanupKind, Long>> = emptySet(), opts: CleanupOptions = CleanupOptions()) =
    cleanupGroups(ps, dismissed, opts)

  private fun ids(gs: List<CleanupGroup>, kind: CleanupKind) = gs.filter { it.kind == kind }.map { g -> g.members.map { it.id }.toSet() }.toSet()

  @Test
  fun copiesGroupResizedNotOthers() {
    val noisy = hex("fffffde5fdffd3d7")
    val gs = groups(listOf(
      photo(1, noisy, 300, 200),
      photo(2, hex("fffffde5fdffd3d7"), 150, 100), // half.png
      photo(3, hex("fbf9f7b1b3f7fbff"), 300, 200), // other.png
      photo(4, noisy xor 0b11111L, 300, 200), // Hamming 5
    ))
    assertEquals(setOf(setOf(1L, 2L)), ids(gs, CleanupKind.COPIES))
    assertEquals("copies:1", gs.single { it.kind == CleanupKind.COPIES }.key)
  }

  @Test
  fun copiesFindHammingFourAcrossChunks() {
    val h = 0x0123456789abcdefL
    val flipped = h xor (1L shl 63) xor (1L shl 45) xor (1L shl 30) xor (1L shl 13) // one bit in each of chunks 0-3
    assertEquals(setOf(setOf(1L, 2L)), ids(groups(listOf(photo(1, h), photo(2, flipped))), CleanupKind.COPIES))
  }

  @Test
  fun copiesNeedSameAspect() {
    val gs = groups(listOf(photo(1, 42L, 300, 200), photo(2, 42L, 200, 300)))
    assertTrue(ids(gs, CleanupKind.COPIES).isEmpty())
  }

  private fun keeper(a: CleanupPhoto, b: CleanupPhoto): Long {
    val g = groups(listOf(a, b)).single { it.kind == CleanupKind.COPIES }
    assertTrue(g.members[0].best && !g.members[0].ticked)
    assertTrue(g.members.drop(1).all { it.ticked && !it.best })
    assertEquals(g.members.drop(1).sumOf { m -> listOf(a, b).single { it.id == m.id }.bytes }, g.bytes)
    return g.members[0].id
  }

  @Test
  fun keeperOrder() {
    assertEquals(2L, keeper(photo(1, 7L, lap = 100f), photo(2, 7L, lap = 200f)))
    assertEquals(1L, keeper(photo(1, 7L, pixels = 20), photo(2, 7L, pixels = 10, bytes = 5000)))
    assertEquals(2L, keeper(photo(1, 7L, bytes = 10, takenAt = 0), photo(2, 7L, bytes = 20, takenAt = 9)))
    assertEquals(2L, keeper(photo(1, 7L, takenAt = 9), photo(2, 7L, takenAt = 5)))
    assertEquals(1L, keeper(photo(1, 7L, takenAt = 5), photo(2, 7L, takenAt = 5)))
  }

  @Test
  fun membersKeeperFirstThenNewest() {
    val g = groups(listOf(photo(1, 7L, takenAt = 1), photo(2, 7L, takenAt = 3, lap = 900f), photo(3, 7L, takenAt = 2)))
      .single { it.kind == CleanupKind.COPIES }
    assertEquals(listOf(2L, 3L, 1L), g.members.map { it.id })
  }

  @Test
  fun lookalikesNeedTimeAndCosine() {
    val a = vec2(100, 0)
    val near = vec2(95, 31) // cosine 0.9507
    val far = vec2(92, 39) // cosine 0.9207
    fun look(b: ByteArray, gap: Long, opts: CleanupOptions = CleanupOptions()) =
      ids(groups(listOf(photo(1, vec = a, takenAt = 0), photo(2, vec = b, takenAt = gap)), opts = opts), CleanupKind.LOOKALIKES)
    assertEquals(setOf(setOf(1L, 2L)), look(near, 9 * min))
    assertTrue(look(near, 11 * min).isEmpty())
    assertTrue(look(far, 9 * min).isEmpty())
    assertTrue(look(near, 9 * min, CleanupOptions(lookalikeCosine = LOOKALIKE_STRICT)).isEmpty())
    val g = groups(listOf(photo(1, vec = a, takenAt = 0), photo(2, vec = near, takenAt = 9 * min)))
      .single { it.kind == CleanupKind.LOOKALIKES }
    assertEquals("lookalikes:1", g.key)
  }

  @Test
  fun zeroVectorNeverLooksAlike() {
    val z = ByteArray(512)
    assertTrue(ids(groups(listOf(photo(1, vec = z, takenAt = 0), photo(2, vec = z, takenAt = 1))), CleanupKind.LOOKALIKES).isEmpty())
  }

  @Test
  fun copiesWinOverLookalikes() {
    val v = vec2(100, 0)
    val gs = groups(listOf(photo(1, 7L, vec = v, takenAt = 0), photo(2, 7L, vec = v, takenAt = min)))
    assertEquals(setOf(setOf(1L, 2L)), ids(gs, CleanupKind.COPIES))
    assertTrue(ids(gs, CleanupKind.LOOKALIKES).isEmpty())
  }

  @Test
  fun groupsSortedByBytesFreed() {
    val gs = groups(listOf(photo(1, 7L, bytes = 10), photo(2, 7L, bytes = 10), photo(3, 7L.inv(), bytes = 50), photo(4, 7L.inv(), bytes = 50)))
      .filter { it.kind == CleanupKind.COPIES }
    assertEquals(listOf("copies:3", "copies:1"), gs.map { it.key })
  }

  @Test
  fun blurryUsesThresholdAndIsUnticked() {
    val ps = listOf(photo(1, lap = 200f, bytes = 5), photo(2, lap = 100f, bytes = 7), photo(3, lap = 299f), photo(4, lap = 20f, bytes = 1))
    fun blurry(t: Double) = groups(ps, opts = CleanupOptions(blurThreshold = t)).single { it.kind == CleanupKind.BLURRY }
    assertEquals(listOf(4L, 2L), blurry(BLUR_DEFAULT).members.map { it.id })
    val g = blurry(250.0)
    assertEquals(listOf(4L, 2L, 1L), g.members.map { it.id })
    assertEquals("blurry", g.key)
    assertEquals(13L, g.bytes)
    assertTrue(g.members.none { it.ticked || it.best })
    assertEquals(listOf(4L, 2L, 1L), blurry(1000.0).members.map { it.id }) // clamped to 298.8
    assertEquals(listOf(4L), blurry(1.0).members.map { it.id }) // clamped to 26.0
  }

  @Test
  fun screenshotsByRelativePath() {
    val gs = groups(listOf(
      photo(1, path = "Pictures/Screenshots/", takenAt = 1), photo(2, path = "DCIM/Camera/"), photo(3, path = null),
      photo(4, path = "Pictures/Screenshots/", takenAt = 2), photo(5, path = "Pictures/screenshots/"),
    ))
    val g = gs.single { it.kind == CleanupKind.SCREENSHOTS }
    assertEquals(listOf(4L, 1L), g.members.map { it.id })
    assertTrue(g.members.none { it.ticked })
  }

  @Test
  fun darkAndBlown() {
    val gs = groups(listOf(
      photo(1, mean = 0.05f, spread = 0.02f), photo(2, mean = 0.05f, spread = 0.2f), photo(3, mean = 0.97f, spread = 0.01f),
      photo(4, mean = 0.5f, spread = 0.01f),
    ))
    assertEquals(setOf(setOf(1L, 3L)), ids(gs, CleanupKind.DARK))
    assertTrue(gs.single { it.kind == CleanupKind.DARK }.members.none { it.ticked })
  }

  @Test
  fun emptyKindsAreOmitted() {
    assertTrue(groups(listOf(photo(1), photo(2))).isEmpty())
  }

  @Test
  fun dismissedNeverReturn() {
    val ps = listOf(photo(1, 7L, lap = 10f), photo(2, 7L), photo(3, 7L))
    val one = groups(ps, setOf(CleanupKind.COPIES to 1L))
    assertEquals(setOf(setOf(2L, 3L)), ids(one, CleanupKind.COPIES))
    assertEquals("copies:2", one.single { it.kind == CleanupKind.COPIES }.key)
    assertEquals(setOf(setOf(1L)), ids(one, CleanupKind.BLURRY)) // dismissal is per kind
    val two = groups(ps, setOf(CleanupKind.COPIES to 1L, CleanupKind.COPIES to 2L, CleanupKind.BLURRY to 1L))
    assertTrue(two.isEmpty())
  }

  @Test
  fun flatPhotosOnlyGroupWithSameAspect() {
    val gs = groups(listOf(
      photo(1, 0L, 64, 48, lap = 0f), photo(2, 0L, 64, 48, lap = 0f), photo(3, 0L, 48, 64, lap = 0f),
      photo(4, 0L, 120, 100, lap = 0f), photo(5, 0L, 1, 1, lap = 0f), photo(6, 0L, 2, 1, lap = 0f),
    ))
    assertEquals(setOf(setOf(1L, 2L)), ids(gs, CleanupKind.COPIES))
    assertEquals(1, gs.single { it.kind == CleanupKind.COPIES }.members.count { it.best })
  }

  @Test
  fun missingMetaIsSkipped() {
    assertTrue(ids(groups(listOf(photo(1, 7L))), CleanupKind.COPIES).isEmpty())
    assertEquals(setOf(setOf(1L, 2L)), ids(groups(listOf(photo(1, 7L), photo(2, 7L))), CleanupKind.COPIES))
  }

  @Test
  fun tenThousandPhotosUnderTwoSeconds() {
    val rnd = Random(20261118)
    val t0 = 1_700_000_000_000L
    var t = t0
    val ps = ArrayList<CleanupPhoto>(10_000)
    fun randVec() = ByteArray(512).also { rnd.nextBytes(it) }
    fun add(dhash: Long, vec: ByteArray, w: Int, h: Int) {
      if (ps.size == 10_000) return
      ps += CleanupPhoto(
        ps.size + 1L, vec, PhotoScores(dhash, rnd.nextFloat(), rnd.nextFloat() * 0.3f, rnd.nextFloat() * 2000f, w, h),
        1_000_000L + rnd.nextInt(5_000_000), t, 12_000_000L, if (rnd.nextInt(100) < 5) "Pictures/Screenshots/" else "DCIM/Camera/",
      )
    }
    while (ps.size < 10_000) {
      when {
        ps.size % 200 == 0 -> { // burst of 5 near-duplicates: copies flip one dhash bit, look-alikes add vector noise
          val h = rnd.nextLong()
          val v = randVec()
          repeat(5) {
            val copy = rnd.nextBoolean()
            val nv = v.copyOf().also { if (!copy) for (k in it.indices) it[k] = (it[k] + rnd.nextInt(9) - 4).coerceIn(-128, 127).toByte() }
            add(if (copy) h xor (1L shl rnd.nextInt(64)) else rnd.nextLong(), nv, 512, 384)
            t += 2_000L + rnd.nextInt(10_000)
          }
        }
        ps.size % 1000 == 500 -> repeat(300) { add(rnd.nextLong(), randVec(), 512, 384); t += 5_000L + rnd.nextInt(30_000) } // dense day
        else -> { add(rnd.nextLong(), randVec(), if (rnd.nextBoolean()) 512 else 384, 384); t += 60_000L + rnd.nextInt(4 * 3_600_000) }
      }
    }
    assertTrue("spans ${(t - t0) / day} days", t - t0 > 365 * day)

    cleanupGroups(ps, emptySet(), CleanupOptions())
    val start = System.nanoTime()
    val gs = cleanupGroups(ps, emptySet(), CleanupOptions())
    val ms = (System.nanoTime() - start) / 1_000_000
    println("cleanupGroups on ${ps.size} photos: $ms ms, ${gs.size} groups")
    assertTrue(gs.any { it.kind == CleanupKind.COPIES })
    assertTrue(gs.any { it.kind == CleanupKind.LOOKALIKES })
    assertTrue(gs.any { it.kind == CleanupKind.SCREENSHOTS })
    assertTrue("took $ms ms", ms < 2000)
  }
}
