package expo.modules.designmedia.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

class PlanJsonTest {
  private val jobs = decodeJobs(fixtureText("job-examples.json"))

  @Test
  fun decodesEveryJobExample() {
    assertEquals(
      listOf(JobState.QUEUED, JobState.RUNNING, JobState.DONE, JobState.FAILED, JobState.PAUSED, JobState.INTERRUPTED),
      jobs.map { it.state },
    )
    assertEquals(Rung(720, 30), (jobs[0].plan as SizePlan).rung)
    assertEquals(SizeAudio("copy"), (jobs[2].plan as SizePlan).audio)
    assertEquals(SizeAudio("aac", 128000), (jobs[0].plan as SizePlan).audio)
    assertEquals("Couldn't fit under 20 MB.", jobs[3].error)
    assertEquals(19650000L, jobs[2].outputs.single().bytes)
  }

  @Test
  fun roundTripsThroughTheSameJsonShape() {
    assertEquals(jobs, decodeJobs(encodeJobs(jobs)))
  }

  @Test(expected = IllegalArgumentException::class)
  fun refusesAPlanWithAToolItDoesNotKnow() {
    decodeJobs(
      """[{"id":"x","inputId":"u","inputName":"a.mp4","state":"queued","progress":0,"attempt":1,"plan":{"tool":"teleport"}}]""",
    )
  }

  @Test
  fun decodesTheExactPlanEveryMediaCorePlannerProduces() {
    val plans = decodeSamples()
    assertEquals(
      setOf(
        "size", "quality", "clipCopy", "clipExact", "audioCopy", "audioRaw", "audioAac", "gif", "gifNoTarget", "convertRemux",
        "convertMuted", "convertHevc", "convertM4a", "frame", "volumeNormalize", "volumeGain", "reverse", "stabilize", "volumeMeasured",
      ),
      plans.keys,
    )
    assertEquals(QualityPlan("hw-h264", Rung(1080, 30), 1920, 1080, 0.1), plans["quality"])
    assertEquals(ClipPlan("copy", 1.5, 6.25, 1.0, "mp4", "mp4", listOf(0, 1)), plans["clipCopy"])
    assertEquals(AudioPlan(2, "raw", "raw", "ac3"), plans["audioRaw"])
    assertEquals(AudioPlan(3, "aac", "mp4", "m4a", 192000), plans["audioAac"])
    assertEquals(GifPlan(1.0, 4.0, 480, 12, 8_000_000L, 1), plans["gif"])
    assertEquals(null, (plans["gifNoTarget"] as GifPlan).targetBytes)
    assertEquals(ConvertPlan("remux", "mp4", "mp4", ConvertVideo("copy", 0.0), null), plans["convertMuted"])
    assertEquals(ConvertAudio("aac", 192000, false), (plans["convertHevc"] as ConvertPlan).audio)
    assertEquals(FramePlan(2.5, "png", "png"), plans["frame"])
    assertEquals(VolumePlan("gain", -6.5, "copy", "mp4"), plans["volumeGain"])
    assertEquals(Loudness(-27.5, -3.1, 6.2, -38.1, 0.4), (plans["volumeMeasured"] as VolumePlan).measured)
    assertEquals(ReversePlan(true, 65.0, "mp4"), plans["reverse"])
    assertEquals(StabilizePlan("recommended", 16, 65.0, "mp4"), plans["stabilize"])
  }

  @Test
  fun everyPlanRoundTripsAndUnknownFieldsAreIgnored() {
    decodeSamples().forEach { (name, plan) -> assertEquals(name, plan, decodePlan(encodePlan(plan))) }
    val withExtras = Json.parseToJsonElement("""{"tool":"frame","timeS":1,"format":"jpg","ext":"jpg","somethingNew":{"a":1}}""").jsonObject
    assertEquals(FramePlan(1.0, "jpg", "jpg"), decodePlan(withExtras))
  }

  @Test
  fun theStatusMapCarriesWhatTheQueueScreenDraws() {
    val job = Job("j", "content://x", "Clip.mp4", FramePlan(1.0, "png", "png"), JobState.DONE, 1.0, 1, emptyList(), null, 5L, 9L)
    val map = job.toStatusMap()
    assertEquals("frame", map["tool"])
    assertEquals("Clip.mp4", map["inputName"])
    assertEquals(5L, map["startedAt"])
    assertEquals(9L, map["finishedAt"])
    assertEquals(false, jobs[0].toStatusMap().containsKey("startedAt"))
    assertEquals(false, jobs[0].toStatusMap().containsKey("error"))
    val noted = job.copy(outputs = listOf(Output("a.mp4", "content://x", 9)))
    assertEquals(listOf(mapOf("name" to "a.mp4", "ref" to "content://x", "bytes" to 9L)), noted.toStatusMap()["outputs"])
    assertEquals("Couldn't fit under 20 MB.", jobs[3].toStatusMap()["error"])
  }
}
