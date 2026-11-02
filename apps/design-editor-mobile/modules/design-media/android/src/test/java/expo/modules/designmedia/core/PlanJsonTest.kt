package expo.modules.designmedia.core

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
    assertEquals(Rung(720, 30), jobs[0].plan.rung)
    assertEquals(SizeAudio("copy"), jobs[2].plan.audio)
    assertEquals(SizeAudio("aac", 128000), jobs[0].plan.audio)
    assertEquals("Couldn't fit under 20 MB.", jobs[3].error)
    assertEquals(19650000L, jobs[2].outputs.single().bytes)
  }

  @Test
  fun roundTripsThroughTheSameJsonShape() {
    assertEquals(jobs, decodeJobs(encodeJobs(jobs)))
  }

  @Test(expected = IllegalArgumentException::class)
  fun refusesAPlanThatIsNotASizeJob() {
    decodeJobs(
      """[{"id":"x","inputId":"u","inputName":"a.mp4","state":"queued","progress":0,"attempt":1,"plan":{"tool":"clip"}}]""",
    )
  }
}
