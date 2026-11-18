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
  fun cancellingOneInterruptedOrPausedRowStopsIt() {
    val rows = listOf(queued.copy(state = JobState.INTERRUPTED), other.copy(state = JobState.PAUSED))
    assertEquals(listOf(JobState.CANCELLED, JobState.PAUSED), reduce(rows, QueueEvent.Cancel(queued.id)).map { it.state })
    assertEquals(listOf(JobState.INTERRUPTED, JobState.CANCELLED), reduce(rows, QueueEvent.Cancel(other.id)).map { it.state })
  }

  @Test
  fun cancelAllLeavesInterruptedAndPausedRows() {
    val rows = listOf(queued.copy(state = JobState.INTERRUPTED), other.copy(state = JobState.PAUSED))
    assertEquals(rows, reduce(rows, QueueEvent.Cancel("all")))
  }

  @Test
  fun aJobLeftRunningWhenTheAppWasKilledShowsAsInterruptedSoItCanBeResumed() {
    val running = reduce(listOf(queued), QueueEvent.Start(queued.id, 10))
    assertEquals(JobState.INTERRUPTED, shownQueue(running, serviceAlive = false)[0].state)
    assertEquals(JobState.RUNNING, shownQueue(running, serviceAlive = true)[0].state)
  }

  private val scan = photoIndexJob("scan-new")
  private fun oldScan(id: String, state: JobState) = photoIndexJob(id).copy(state = state)

  @Test
  fun aNewScanReplacesFinishedScanRows() {
    val before = listOf(
      oldScan("d", JobState.DONE), oldScan("f", JobState.FAILED), oldScan("c", JobState.CANCELLED),
      oldScan("q", JobState.QUEUED), oldScan("r", JobState.RUNNING), oldScan("p", JobState.PAUSED), oldScan("i", JobState.INTERRUPTED),
    )
    val q = reduce(before, QueueEvent.Enqueue(listOf(scan)))
    assertEquals(listOf("q", "r", "p", "i", "scan-new"), q.map { it.id })
  }

  @Test
  fun videoRowsStayWhenAScanIsAdded() {
    val done = queued.copy(state = JobState.DONE)
    val q = reduce(listOf(done, other), QueueEvent.Enqueue(listOf(scan)))
    assertEquals(listOf(done.id, other.id, "scan-new"), q.map { it.id })
  }

  @Test
  fun addingAVideoKeepsFinishedScanRows() {
    val finished = oldScan("d", JobState.DONE)
    val q = reduce(listOf(finished), QueueEvent.Enqueue(listOf(other)))
    assertEquals(listOf("d", other.id), q.map { it.id })
  }

  @Test
  fun removeDropsOnlyThatFinishedRowAndLeavesTheRestInOrder() {
    val done = queued.copy(state = JobState.DONE, outputs = listOf(Output("a.mp4", "r", 1)))
    val failed = other.copy(state = JobState.FAILED)
    val third = other.copy(id = "job-z", state = JobState.CANCELLED)
    val q = reduce(listOf(done, failed, third), QueueEvent.Remove(failed.id))
    assertEquals(listOf(done.id, third.id), q.map { it.id })
    assertEquals(done.outputs, q[0].outputs)
  }

  @Test
  fun removeLeavesRunningAndWaitingJobsAloneButTakesPausedAndInterruptedRows() {
    val rows = listOf(
      queued.copy(state = JobState.RUNNING), other.copy(id = "w", state = JobState.QUEUED),
      other.copy(id = "p", state = JobState.PAUSED), other.copy(id = "i", state = JobState.INTERRUPTED),
    )
    assertEquals(rows, reduce(rows, QueueEvent.Remove(queued.id)))
    assertEquals(rows, reduce(rows, QueueEvent.Remove("w")))
    assertEquals(listOf(queued.id, "w", "i"), reduce(rows, QueueEvent.Remove("p")).map { it.id })
    assertEquals(listOf(queued.id, "w", "p"), reduce(rows, QueueEvent.Remove("i")).map { it.id })
    assertEquals(rows, reduce(rows, QueueEvent.Remove("nope")))
  }

  @Test
  fun reduceDoesNotChangeTheInput() {
    val before = listOf(queued)
    reduce(before, QueueEvent.Cancel("all"))
    assertEquals(JobState.QUEUED, before[0].state)
  }
}
