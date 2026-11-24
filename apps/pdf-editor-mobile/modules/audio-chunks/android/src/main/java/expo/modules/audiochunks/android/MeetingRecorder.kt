package expo.modules.audiochunks.android

import android.content.Context
import android.media.AudioManager
import android.media.AudioRecordingConfiguration
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import expo.modules.audiochunks.core.MeetingClock
import java.io.File

object MeetingRecorder {
  private const val SAMPLE_RATE = 44_100
  private const val BIT_RATE = 64_000 // speech, mono: about 29 MB an hour

  private var recorder: MediaRecorder? = null
  private var context: Context? = null
  private var clock: MeetingClock? = null
  private var error: String? = null

  private val silenceWatch by lazy {
    object : AudioManager.AudioRecordingCallback() {
      override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) silenced(configs.any { it.isClientSilenced })
      }
    }
  }

  val isRecording: Boolean @Synchronized get() = recorder != null

  // ADTS has no index to write at the end, so whatever reached the file before a kill or crash stays playable.
  @Synchronized
  fun start(context: Context, path: String) {
    check(recorder == null) { "A meeting is already recording." }
    val file = File(path)
    file.parentFile?.mkdirs()
    file.delete()
    val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
    try {
      r.setAudioSource(MediaRecorder.AudioSource.MIC)
      r.setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS)
      r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
      r.setAudioSamplingRate(SAMPLE_RATE)
      r.setAudioChannels(1)
      r.setAudioEncodingBitRate(BIT_RATE)
      r.setOutputFile(path)
      r.setOnErrorListener { _, _, _ -> fail("The microphone stopped working.") }
      r.prepare()
      r.start()
    } catch (e: Exception) {
      r.release()
      throw e
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) r.registerAudioRecordingCallback(context.mainExecutor, silenceWatch)
    recorder = r
    this.context = context.applicationContext
    clock = MeetingClock(SystemClock.elapsedRealtime())
    error = null
  }

  /** Stops and closes the file; `reason` is kept when the recording ended without the user. */
  @Synchronized
  fun stop(reason: String?): Map<String, Any?> {
    val r = recorder ?: return status()
    recorder = null
    if (reason != null) error = reason
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) r.unregisterAudioRecordingCallback(silenceWatch)
    try {
      r.stop()
    } catch (e: RuntimeException) {
      if (error == null) error = "Nothing was recorded."
    } finally {
      r.release()
      clock?.stop(SystemClock.elapsedRealtime())
    }
    return status()
  }

  @Synchronized
  fun status(): Map<String, Any?> {
    val now = SystemClock.elapsedRealtime()
    val c = clock
    return mapOf(
      "recording" to (recorder != null),
      "elapsedMs" to (c?.elapsedMs(now) ?: 0L).toDouble(),
      "silenced" to (c?.silenced ?: false),
      "silencedMs" to (c?.silencedMs(now) ?: 0L).toDouble(),
      "error" to error,
    )
  }

  @Synchronized
  private fun silenced(on: Boolean) {
    if (recorder != null) clock?.setSilenced(on, SystemClock.elapsedRealtime())
  }

  private fun fail(reason: String) {
    stop(reason)
    context?.let { MeetingService.stop(it) }
  }
}
