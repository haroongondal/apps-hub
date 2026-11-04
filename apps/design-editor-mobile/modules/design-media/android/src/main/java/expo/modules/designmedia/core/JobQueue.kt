package expo.modules.designmedia.core

// Attempt is Kotlin-only: it keeps the per-attempt log the Media lab shows; the TS Job type has no such field.
sealed interface QueueEvent {
  data class Enqueue(val jobs: List<Job>) : QueueEvent
  data class Start(val id: String, val at: Long) : QueueEvent
  data class Progress(val id: String, val fraction: Double) : QueueEvent
  data class Retry(val id: String, val plan: Plan) : QueueEvent
  data class Attempt(val id: String, val log: AttemptLog) : QueueEvent
  data class Done(val id: String, val outputs: List<Output>, val at: Long) : QueueEvent
  data class Fail(val id: String, val error: String, val at: Long) : QueueEvent
  data class Cancel(val id: String) : QueueEvent
  data object Interrupt : QueueEvent
  data object Pause : QueueEvent
  data object Resume : QueueEvent
}

fun reduce(jobs: List<Job>, e: QueueEvent): List<Job> = when (e) {
  is QueueEvent.Enqueue -> jobs + e.jobs
  is QueueEvent.Start -> update(jobs, e.id) { it.copy(state = JobState.RUNNING, attempt = 1, progress = 0.0, startedAt = e.at) }
  is QueueEvent.Progress -> update(jobs, e.id) { if (it.state == JobState.RUNNING) it.copy(progress = e.fraction) else it }
  is QueueEvent.Retry -> update(jobs, e.id) { it.copy(plan = e.plan, attempt = it.attempt + 1, progress = 0.0) }
  is QueueEvent.Attempt -> update(jobs, e.id) { it.copy(attempts = it.attempts + e.log) }
  is QueueEvent.Done -> update(jobs, e.id) {
    it.copy(state = JobState.DONE, outputs = e.outputs, progress = 1.0, finishedAt = e.at)
  }
  is QueueEvent.Fail -> update(jobs, e.id) { it.copy(state = JobState.FAILED, error = e.error, finishedAt = e.at) }
  is QueueEvent.Cancel -> jobs.map {
    val matches = e.id == "all" || it.id == e.id
    if (matches && (it.state == JobState.QUEUED || it.state == JobState.RUNNING)) it.copy(state = JobState.CANCELLED) else it
  }
  QueueEvent.Interrupt -> jobs.map { if (it.state == JobState.RUNNING) it.copy(state = JobState.INTERRUPTED) else it }
  QueueEvent.Pause -> jobs.map { if (it.state == JobState.RUNNING) it.copy(state = JobState.PAUSED) else it }
  QueueEvent.Resume -> jobs.map {
    if (it.state == JobState.PAUSED || it.state == JobState.INTERRUPTED) it.copy(state = JobState.QUEUED, error = null) else it
  }
}

fun nextRunnable(jobs: List<Job>): Job? {
  if (jobs.any { it.state == JobState.RUNNING }) return null
  return jobs.firstOrNull { it.state == JobState.QUEUED }
}

private fun update(jobs: List<Job>, id: String, f: (Job) -> Job): List<Job> =
  jobs.map { if (it.id == id) f(it) else it }
