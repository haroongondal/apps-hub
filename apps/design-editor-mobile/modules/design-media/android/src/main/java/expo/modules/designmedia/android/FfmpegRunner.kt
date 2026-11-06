package expo.modules.designmedia.android

import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFmpegKitConfig
import com.arthenica.ffmpegkit.FFmpegSession
import com.arthenica.ffmpegkit.Level
import com.arthenica.ffmpegkit.ReturnCode
import expo.modules.designmedia.core.FfmpegArgs
import expo.modules.designmedia.core.Plan
import expo.modules.designmedia.core.ReversePlan
import expo.modules.designmedia.core.StabilizePlan
import expo.modules.designmedia.core.VolumePlan
import expo.modules.designmedia.core.qualityBps

// Volume, reverse and stabilize only. Input goes through FFmpegKit's read-only SAF parameter and the output is
// a plain file in the job's cache folder, so nothing but this app's own temp file is ever written.
class FfmpegRunner private constructor(
  private val req: Request,
  private val source: Probe.Source,
  private val done: (Outcome) -> Unit,
) : Runner {
  @Volatile private var fraction: Double? = null
  @Volatile private var session: FFmpegSession? = null
  @Volatile private var cancelled = false

  override fun progress() = fraction

  override fun cancel() {
    cancelled = true
    session?.cancel()
  }

  private fun begin() {
    try {
      FFmpegKitConfig.setLogLevel(Level.AV_LOG_INFO)
      val plan = req.plan
      if (plan is VolumePlan && plan.mode == "normalize" && plan.measured == null) {
        run(FfmpegArgs.loudnormMeasure(readParameter()), 0.0, MEASURE_SHARE) { log ->
          val measured = FfmpegArgs.parseLoudnorm(log)
          if (measured == null) fail("loudness not measured") else encode(plan.copy(measured = measured), MEASURE_SHARE)
        }
      } else {
        encode(plan, 0.0)
      }
    } catch (e: Throwable) {
      fail("ffmpeg unavailable: $e")
    }
  }

  private fun encode(plan: Plan, from: Double) {
    val args = try {
      val input = readParameter()
      val out = req.out.absolutePath
      val bps = qualityBps(HIGH_BPP, maxOf(source.width, 1), maxOf(source.height, 1), source.fps ?: 30, source.videoBps)
      when (plan) {
        is VolumePlan -> FfmpegArgs.volume(plan, input, out, bps)
        is ReversePlan -> FfmpegArgs.reverse(plan, input, out, bps)
        is StabilizePlan -> FfmpegArgs.stabilize(plan, input, out, bps)
        else -> throw IllegalArgumentException("Not an FFmpeg job: ${plan.tool}")
      }
    } catch (e: Exception) {
      return fail("setup failed: $e")
    }
    run(args, from, 1.0) { done(Outcome.Written()) }
  }

  private fun run(args: List<String>, from: Double, to: Double, onSuccess: (String) -> Unit) {
    val log = StringBuilder()
    session = FFmpegKit.executeWithArgumentsAsync(
      args.toTypedArray(),
      { s ->
        val text = synchronized(log) { log.toString() }
        req.handler.post { settle(s, text, onSuccess) }
      },
      { l -> synchronized(log) { log.append(l.message).also { if (log.length > LOG_KEEP * 2) log.delete(0, log.length - LOG_KEEP) } } },
      { st ->
        if (source.durationS > 0 && st.time > 0) fraction = from + (to - from) * minOf(1.0, st.time / 1000.0 / source.durationS)
      },
    )
  }

  private fun settle(s: FFmpegSession, log: String, onSuccess: (String) -> Unit) {
    if (cancelled) return
    if (ReturnCode.isSuccess(s.returnCode)) onSuccess(log) else fail("ffmpeg exit ${s.returnCode}: ${log.takeLast(300)}")
  }

  private fun readParameter(): String = FFmpegKitConfig.getSafParameterForRead(req.context, req.input)

  private fun fail(detail: String) = done(Outcome.Failed(detail))

  companion object {
    private const val MEASURE_SHARE = 0.35
    private const val HIGH_BPP = 0.14
    private const val LOG_KEEP = 8_192

    fun start(req: Request, source: Probe.Source, done: (Outcome) -> Unit): Runner = FfmpegRunner(req, source, done).also { it.begin() }
  }
}
