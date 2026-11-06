package expo.modules.strongroomvault.android

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import kotlin.concurrent.thread

/** Every 15 minutes: download only, with the read token, into the staging table; merging and uploading wait for an unlock (DESIGN §10, R18). */
class SyncJobService : JobService() {
  override fun onStartJob(params: JobParameters): Boolean {
    thread(name = "strongroom-sync-job") {
      VaultHolder.download(applicationContext)
      jobFinished(params, false)
    }
    return true
  }

  override fun onStopJob(params: JobParameters) = true

  companion object {
    private const val JOB_ID = 7402

    // No network constraint and not persisted: on targetSdk 34+ the first needs ACCESS_NETWORK_STATE and the second RECEIVE_BOOT_COMPLETED, and the app holds neither. An offline run ends at the first connect.
    fun schedule(context: Context) {
      val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
      if (scheduler.getPendingJob(JOB_ID) != null) return
      scheduler.schedule(JobInfo.Builder(JOB_ID, ComponentName(context, SyncJobService::class.java)).setPeriodic(15 * 60_000L).build())
    }
  }
}
