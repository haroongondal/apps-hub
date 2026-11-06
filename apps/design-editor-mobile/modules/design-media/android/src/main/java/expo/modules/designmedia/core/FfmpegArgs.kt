package expo.modules.designmedia.core

import java.math.BigDecimal
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// Phone arguments for the three tools Media3 can't do: volume, reverse, stabilize. They mirror
// packages/media-core/src/ffmpeg.ts, with the phone's differences: h264_mediacodec instead of
// h264_videotoolbox, no -progress pipe (progress comes from the statistics callback), -pix_fmt yuv420p on every encode.
object FfmpegArgs {
  const val LOUDNESS_TARGET_LUFS = -23
  private val GLOBAL = listOf("-hide_banner", "-y")
  private val STRIP = listOf("-map_metadata", "-1")
  private val AAC = listOf("-c:a", "aac", "-b:a", "192k")
  private val FASTSTART = listOf("-movflags", "+faststart")

  fun loudnormMeasure(input: String): List<String> =
    listOf("-hide_banner", "-i", input, "-vn", "-map", "0:a:0", "-af", "loudnorm=I=$LOUDNESS_TARGET_LUFS:LRA=11:TP=-1.5:print_format=json", "-f", "null", "-")

  fun volume(plan: VolumePlan, input: String, output: String, videoBps: Int): List<String> {
    val af = if (plan.mode == "normalize") loudnormGraph(plan.measured) else "volume=${num(plan.gainDb)}dB"
    val audio = listOf("-map", "0:a:0", "-af", af) + AAC
    if (plan.video == null) return GLOBAL + listOf("-i", input, "-vn") + audio + STRIP + output
    val video = if (plan.video == "copy") listOf("-c:v", "copy") else h264(videoBps)
    return GLOBAL + listOf("-i", input, "-map", "0:v:0") + video + audio + FASTSTART + STRIP + output
  }

  fun reverse(plan: ReversePlan, input: String, output: String, videoBps: Int): List<String> {
    val sound = if (plan.sound) listOf("-map", "0:a:0?", "-af", "areverse") + AAC else listOf("-an")
    return GLOBAL + listOf("-i", input, "-map", "0:v:0", "-vf", "reverse") + h264(videoBps) + sound + FASTSTART + STRIP + output
  }

  // FFmpeg 8.1's deshake refuses any range that is not a multiple of 16 and caps it at 64. A job queued by an older build can still carry 8 or 40.
  fun deshakeRange(search: Int): Int = (search.coerceIn(16, 64) + 15) / 16 * 16

  // Passes, not range, make the picture steadier (measured 2026-11-06); mirrors STABILIZE_PASSES in media-core/stabilize.ts.
  fun deshakePasses(level: String): Int = if (level == "minimum") 1 else 2

  fun stabilize(plan: StabilizePlan, input: String, output: String, videoBps: Int): List<String> {
    val range = deshakeRange(plan.search)
    val pass = "deshake=rx=$range:ry=$range:edge=mirror:search=less"
    val chain = List(deshakePasses(plan.level)) { pass }.joinToString(",")
    return GLOBAL + listOf("-i", input, "-map", "0:v:0", "-vf", chain) +
      h264(videoBps) + listOf("-map", "0:a:0?") + AAC + FASTSTART + STRIP + output
  }

  // loudnorm's first pass prints one flat JSON object near the end of the log. Missing or non-numeric fields mean the measure failed.
  fun parseLoudnorm(log: String): Loudness? {
    val end = log.lastIndexOf('}')
    val start = if (end < 0) -1 else log.lastIndexOf('{', end)
    if (start < 0) return null
    val fields = try {
      Json.parseToJsonElement(log.substring(start, end + 1)).jsonObject
    } catch (e: Exception) {
      return null
    }
    val v = listOf("input_i", "input_tp", "input_lra", "input_thresh", "target_offset").map {
      fields[it]?.jsonPrimitive?.content?.toDoubleOrNull()?.takeIf { d -> d.isFinite() } ?: return null
    }
    return Loudness(v[0], v[1], v[2], v[3], v[4])
  }

  // Pass two applies the measured loudness linearly; without a measure it falls back to loudnorm's one-pass mode.
  private fun loudnormGraph(m: Loudness?): String {
    val base = "loudnorm=I=$LOUDNESS_TARGET_LUFS:LRA=11:TP=-1.5"
    if (m == null) return base
    return "$base:measured_I=${num(m.inputI)}:measured_TP=${num(m.inputTp)}:measured_LRA=${num(m.inputLra)}" +
      ":measured_thresh=${num(m.inputThresh)}:offset=${num(m.offset)}:linear=true"
  }

  private fun h264(bps: Int) = listOf("-c:v", "h264_mediacodec", "-b:v", bps.toString(), "-pix_fmt", "yuv420p")

  // 3.0 prints as 3 and 1.0E-4 as 0.0001, the way JavaScript prints them.
  private fun num(d: Double): String = BigDecimal(d.toString()).stripTrailingZeros().toPlainString()
}
