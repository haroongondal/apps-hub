package expo.modules.audiochunks

import expo.modules.audiochunks.android.AudioCutter
import expo.modules.audiochunks.android.MeetingRecorder
import expo.modules.audiochunks.android.MeetingService
import expo.modules.audiochunks.core.CutWindow
import expo.modules.audiochunks.core.filePath
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class AudioChunksModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AudioChunks")

    AsyncFunction("durationMs") { uri: String ->
      try {
        AudioCutter.durationMs(filePath(uri))
      } catch (e: Exception) {
        throw CodedException("READ_FAILED", "The recording could not be read: ${e.message}", e)
      }
    }

    AsyncFunction("cut") { uri: String, startMs: Double, endMs: Double, outUri: String ->
      val outPath = filePath(outUri)
      try {
        AudioCutter.cut(filePath(uri), CutWindow(startMs, endMs), outPath).toDouble()
      } catch (e: Exception) {
        File(outPath).delete()
        throw CodedException("CUT_FAILED", "The recording could not be cut: ${e.message}", e)
      }
    }

    AsyncFunction("startMeeting") { outUri: String ->
      val context = appContext.reactContext?.applicationContext ?: throw CodedException("START_FAILED", "Nexus is not ready to record yet.", null)
      if (MeetingRecorder.isRecording) throw CodedException("START_FAILED", "A meeting is already recording.", null)
      try {
        MeetingRecorder.start(context, filePath(outUri))
        MeetingService.start(context)
      } catch (e: Exception) {
        MeetingRecorder.stop(null)
        throw CodedException("START_FAILED", "The recording could not start: ${e.message}", e)
      }
    }

    AsyncFunction("stopMeeting") {
      val status = MeetingRecorder.stop(null)
      appContext.reactContext?.let { MeetingService.stop(it) }
      status
    }

    Function("meetingStatus") {
      MeetingRecorder.status()
    }
  }
}
