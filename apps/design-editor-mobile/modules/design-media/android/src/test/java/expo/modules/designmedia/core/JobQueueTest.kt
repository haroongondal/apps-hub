package expo.modules.designmedia.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class JobQueueTest {
  private val examples = decodeJobs(fixtureText("job-examples.json"))
  private val queued = examples[0]
  private val other = queued.copy(id = "job-x", inputName = "Other.mp4")

  @Test
  fun startProgressDoneFollowTheStateMachine() {
    var q = reduce(emptyList(), QueueEvent.Enqueue(listOf(queued)))
    q = reduce(q, QueueEvent.Start(queued.id, 10))
    assertEquals(JobState.RUNNING, q[0].state)
    q = reduce(q, QueueEvent.Progress(queued.id, 0.5))
    assertEquals(0.5, q[0].progress, 0.0)
    q = reduce(q, QueueEvent.Done(queued.id, listOf(Output("a.mp4", "r", 1)), 20))
    assertEquals(JobState.DONE, q[0].state)
    assertEquals(20L, q[0].finishedAt)
  }

  @Test
  fun retryBumpsTheAttemptAndResetsProgress() {
    val running = queued.copy(state = JobState.RUNNING, progress = 0.9)
    val q = reduce(listOf(running), QueueEvent.Retry(running.id, examples[1].plan))
    assertEquals(2, q[0].attempt)
    assertEquals(0.0, q[0].progress, 0.0)
  }

  @Test
  fun cancelAllStopsTheRunningJobAndEveryQueuedOne() {
    val q = reduce(
      listOf(queued.copy(state = JobState.RUNNING), other, other.copy(id = "job-y", state = JobState.DONE)),
      QueueEvent.Cancel("all"),
    )
    assertEquals(listOf(JobState.CANCELLED, JobState.CANCELLED, JobState.DONE), q.map { it.state })
  }

  @Test
  fun pauseAndInterruptStopAJobAndResumeRequeuesIt() {
    val paused = reduce(listOf(queued.copy(state = JobState.RUNNING)), QueueEvent.Pause)
    assertEquals(JobState.PAUSED, paused[0].state)
    val interrupted = reduce(listOf(queued.copy(state = JobState.RUNNING)), QueueEvent.Interrupt)
    assertEquals(JobState.INTERRUPTED, interrupted[0].state)
    val resumed = reduce(listOf(paused[0], interrupted[0]), QueueEvent.Resume)
    assertEquals(listOf(JobState.QUEUED, JobState.QUEUED), resumed.map { it.state })
  }

  @Test
  fun onlyOneJobRunsAtATimeInQueueOrder() {
    assertEquals(queued.id, nextRunnable(listOf(queued, other))?.id)
    assertNull(nextRunnable(listOf(queued.copy(state = JobState.RUNNING), other)))
    assertNull(nextRunnable(listOf(queued.copy(state = JobState.DONE))))
  }

  @Test
  fun attemptLogsAppendToTheJob() {
    val log = AttemptLog(1, 18_000_000, 19_000_000, 42.5, "vbr")
    val q = reduce(listOf(queued), QueueEvent.Attempt(queued.id, log))
    assertEquals(listOf(log), q[0].attempts)
  }

  @Test
  fun aJobLeftRunningWhenTheAppWasKilledShowsAsInterruptedSoItCanBeResumed() {
    val running = reduce(listOf(queued), QueueEvent.Start(queued.id, 10))
    assertEquals(JobState.INTERRUPTED, shownQueue(running, serviceAlive = false)[0].state)
    assertEquals(JobState.RUNNING, shownQueue(running, serviceAlive = true)[0].state)
  }

  @Test
  fun reduceDoesNotChangeTheInput() {
    val before = listOf(queued)
    reduce(before, QueueEvent.Cancel("all"))
    assertEquals(JobState.QUEUED, before[0].state)
  }
}
