package expo.modules.designmedia.core

import org.junit.Assert.assertEquals
import org.junit.Test

// Replays MediaJobService's record-then-pump order for a five-job batch, saving and reloading after every event.
class BatchSequenceTest {
  private val fixtures = decodeJobs(fixtureText("job-examples.json"))

  @Test
  fun aFiveJobBatchFinishesAndKeepsEveryEntry() {
    val store = QueueStore(FakeTextFile())
    val existing = listOf(fixtures[2], fixtures[4])
    val batch = (0 until 5).map { i ->
      fixtures[0].copy(
        id = "s3-1793619245609-$i",
        inputName = "Clip$i.mp4",
        state = JobState.QUEUED,
        progress = 0.0,
        attempt = 1,
        outputs = emptyList(),
      )
    }
    store.save(existing)
    fun record(event: QueueEvent) = store.save(reduce(store.load(), event))

    record(QueueEvent.Enqueue(batch))
    var next = nextRunnable(store.load())
    var ran = 0
    while (next != null) {
      val id = next.id
      record(QueueEvent.Start(id, 1L))
      record(QueueEvent.Attempt(id, AttemptLog(1, next.plan.plannedBytes, 26_100_000, 34.0, "vbr")))
      record(QueueEvent.Retry(id, next.plan))
      record(QueueEvent.Attempt(id, AttemptLog(2, next.plan.plannedBytes, 14_200_000, 30.0, "vbr")))
      record(QueueEvent.Done(id, listOf(Output("$id.mp4", "content://media/$id", 14_200_000)), 2L))
      ran++
      next = nextRunnable(store.load())
    }

    assertEquals(5, ran)
    val after = store.load()
    assertEquals(existing.map { it.id } + batch.map { it.id }, after.map { it.id })
    assertEquals(List(5) { JobState.DONE }, batch.map { job -> after.first { it.id == job.id }.state })
  }
}
