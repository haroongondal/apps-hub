package expo.modules.designmedia.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FakeTextFile : TextFile {
  var text: String? = null
  override fun read(): String? = text
  override fun write(text: String) {
    this.text = text
  }
}

class QueueStoreTest {
  private val jobs = decodeJobs(fixtureText("job-examples.json"))

  @Test
  fun loadsAnEmptyQueueWhenNothingWasSaved() {
    assertEquals(emptyList<Job>(), QueueStore(FakeTextFile()).load())
  }

  @Test
  fun savesAndLoadsTheSameJobs() {
    val store = QueueStore(FakeTextFile())
    store.save(jobs)
    assertEquals(jobs, store.load())
  }

  @Test
  fun aRunningJobComesBackInterruptedAndIsNotRestarted() {
    val file = FakeTextFile()
    val store = QueueStore(file)
    store.save(listOf(jobs[1]))
    store.save(reduce(store.load(), QueueEvent.Interrupt))
    val reloaded = store.load()
    assertEquals(JobState.INTERRUPTED, reloaded[0].state)
    assertNull(nextRunnable(reloaded))
    assertEquals(reloaded, QueueStore(file).load())
  }
}
