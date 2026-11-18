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
  fun marginKeepsOnlyScoresNearTheBest() {
    // Scores 0.9, 0.86, 0.8, 0.3 against axis 0.
    val rows = listOf(0.9f, 0.86f, 0.8f, 0.3f).mapIndexed { i, c ->
      PhotoRow(PhotoKey(i.toLong(), 0, 0), quantize(FloatArray(512).also { it[0] = c; it[1] = sqrt(1 - c * c) }))
    }
    assertEquals(listOf(0L, 1L), rank(rows, unitAxis(0), 10, 0.2f, 0.05f))
    assertEquals(listOf(0L, 1L, 2L, 3L), rank(rows, unitAxis(0), 10, 0.2f))
    assertTrue(rank(rows, unitAxis(0), 10, 0.95f, 0.05f).isEmpty())
  }

  @Test
  fun shortQueriesAreWordedAsCaptions() {
    assertEquals("a photo of sky", searchText(" sky "))
    assertEquals("a photo of red car at", searchText("red car at"))
    assertEquals("dog on the beach", searchText("dog on the beach"))
  }

  @Test
  fun tiesKeepIndexOrder() {
    val rows = (5L..7L).map { PhotoRow(PhotoKey(it, 0, 0), quantize(unitAxis(0))) }
    assertEquals(listOf(5L, 6L, 7L), rank(rows, unitAxis(0), 10, 0f))
  }

  @Test
  fun jobToAddSkipsWhenOneIsWaiting() {
    val other = photoIndexJob("v").copy(plan = FramePlan(1.0, "png", "png"), inputId = "content://v")
    listOf(JobState.QUEUED, JobState.RUNNING).forEach { s ->
      assertEquals(null, jobToAdd(listOf(other, photoIndexJob("a").copy(state = s)), "b"))
    }
    val ended = listOf(JobState.DONE, JobState.FAILED).map { photoIndexJob(it.name).copy(state = it) }
    val added = jobToAdd(ended + other.copy(state = JobState.QUEUED), "b")
    assertEquals(photoIndexJob("b"), added)
    assertEquals(PhotoIndexPlan, added?.plan)
    assertEquals("gallery", added?.inputId)
    assertEquals(Messages.PHOTOS, added?.inputName)
    assertEquals(JobState.QUEUED, added?.state)
  }

  @Test
  fun aSecondScanIsDroppedWhileOneWaits() {
    listOf(JobState.QUEUED, JobState.RUNNING).forEach { s ->
      assertEquals(emptyList<Job>(), withoutDuplicateScans(listOf(photoIndexJob("a").copy(state = s)), listOf(photoIndexJob("b"))))
    }
  }

  @Test
  fun aScanIsKeptWhenTheLastOneFinished() {
    listOf(JobState.DONE, JobState.FAILED, JobState.CANCELLED).forEach { s ->
      assertEquals(listOf(photoIndexJob("b")), withoutDuplicateScans(listOf(photoIndexJob("a").copy(state = s)), listOf(photoIndexJob("b"))))
    }
  }

  @Test
  fun twoScansInOneBatchBecomeOne() {
    assertEquals(listOf(photoIndexJob("a")), withoutDuplicateScans(emptyList(), listOf(photoIndexJob("a"), photoIndexJob("b"))))
  }

  @Test
  fun videoJobsAreNeverDropped() {
    val video = { id: String -> photoIndexJob(id).copy(plan = FramePlan(1.0, "png", "png"), inputId = "content://$id") }
    val incoming = listOf(video("x"), photoIndexJob("b"), video("y"))
    assertEquals(incoming, withoutDuplicateScans(listOf(video("w")), incoming))
    assertEquals(listOf(video("x"), video("y")), withoutDuplicateScans(listOf(photoIndexJob("a")), incoming))
  }

  @Test
  fun diffDropsDuplicateRows() {
    val first = row(1)
    val d = diff(listOf(first.key, row(2).key), listOf(first, row(1, fill = 9), row(2), row(2)))
    assertEquals(listOf(1L, 2L), d.keep.map { it.key.id })
    assertTrue(d.keep[0] === first)
    assertEquals(emptyList<PhotoKey>(), d.toEmbed)
  }

  @Test
  fun aPhotoScanFailureTalksAboutPhotos() {
    assertEquals(Messages.PHOTOS_FAILED, failureMessage(PhotoIndexPlan))
    assertEquals(Messages.COULDNT_PROCESS, failureMessage(FramePlan(1.0, "png", "png")))
  }

  @Test
  fun aPhotoScanLeavesTheCbrChoiceAlone() {
    val video = photoIndexJob("v").copy(plan = FramePlan(1.0, "png", "png"))
    assertTrue(cbrOnlyAfter(true, listOf(photoIndexJob("p")), false))
    assertFalse(cbrOnlyAfter(false, listOf(photoIndexJob("p")), true))
    assertFalse(cbrOnlyAfter(true, listOf(photoIndexJob("p"), video), false))
    assertTrue(cbrOnlyAfter(false, listOf(video), true))
  }

  @Test
  fun aScanLeftRunningByAKilledAppIsStartedAgain() {
    val stale = listOf(photoIndexJob("a").copy(state = JobState.RUNNING))
    val start = planIndexStart(shownQueue(stale, serviceAlive = false), "b")
    assertEquals(photoIndexJob("b"), start.job)
    assertEquals("b", start.id)
  }

  @Test
  fun aScanThatIsReallyRunningIsNotAddedTwice() {
    val live = listOf(photoIndexJob("a").copy(state = JobState.RUNNING))
    val start = planIndexStart(shownQueue(live, serviceAlive = true), "b")
    assertEquals(null, start.job)
    assertEquals("a", start.id)
  }

  @Test
  fun anEmptyEnqueueLeavesTheCbrChoiceAlone() {
    assertTrue(cbrOnlyAfter(true, emptyList(), false))
    assertFalse(cbrOnlyAfter(false, emptyList(), true))
  }

  @Test
  fun backOffRule() {
    assertTrue(shouldPause(19, false, 0))
    assertFalse(shouldPause(19, true, 0))
    assertFalse(shouldPause(20, false, 0))
    assertTrue(shouldPause(80, true, 3))
    assertFalse(shouldPause(80, false, 2))
  }

  @Test
  fun pauseReasonHeatWinsOverBattery() {
    assertEquals("heat", pauseReason(10, false, 3))
    assertEquals("battery", pauseReason(10, false, 0))
    assertEquals(null, pauseReason(10, true, 2))
    assertEquals("heat", pauseReason(80, false, 4))
  }

  @Test
  fun needsScanWhenNothingSavedOrChanged() {
    assertTrue(needsScan(null, "1:5"))
    assertFalse(needsScan("1:5", "1:5"))
    assertTrue(needsScan("1:5", "1:6"))
  }

  @Test
  fun aNewScanStopsTheStaleOnes() {
    val old = listOf(
      photoIndexJob("i").copy(state = JobState.INTERRUPTED),
      photoIndexJob("p").copy(state = JobState.PAUSED),
      photoIndexJob("d").copy(state = JobState.DONE),
    )
    val start = planIndexStart(shownQueue(old, serviceAlive = true), "n")
    assertEquals(photoIndexJob("n"), start.job)
    assertEquals(listOf("i", "p"), start.stale)
    val waiting = planIndexStart(shownQueue(old + photoIndexJob("q"), serviceAlive = true), "n")
    assertEquals(null, waiting.job)
    assertEquals(emptyList<String>(), waiting.stale)
  }
}
