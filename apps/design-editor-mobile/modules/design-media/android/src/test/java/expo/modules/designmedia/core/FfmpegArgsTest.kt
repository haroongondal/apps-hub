package expo.modules.designmedia.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Golden argument lists: any change to a phone command line shows up here first.
class FfmpegArgsTest {
  private val measured = Loudness(-31.45, -12.07, 0.0, -41.45, 0.33)

  @Test
  fun theMeasurePassReadsTheFirstAudioTrackToNowhere() {
    assertEquals(
      listOf("-hide_banner", "-i", "saf:1.mp4", "-vn", "-map", "0:a:0", "-af", "loudnorm=I=-23:LRA=11:TP=-1.5:print_format=json", "-f", "null", "-"),
      FfmpegArgs.loudnormMeasure("saf:1.mp4"),
    )
  }

  @Test
  fun aMeasuredNormalizeCopiesThePictureAndAppliesTheMeasureLinearly() {
    val plan = VolumePlan("normalize", 0.0, "copy", "mp4", measured)
    assertEquals(
      listOf(
        "-hide_banner", "-y", "-i", "saf:1.mp4", "-map", "0:v:0", "-c:v", "copy",
        "-map", "0:a:0", "-af",
        "loudnorm=I=-23:LRA=11:TP=-1.5:measured_I=-31.45:measured_TP=-12.07:measured_LRA=0:measured_thresh=-41.45:offset=0.33:linear=true",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-map_metadata", "-1", "/cache/jobs/j/attempt-1.mp4",
      ),
      FfmpegArgs.volume(plan, "saf:1.mp4", "/cache/jobs/j/attempt-1.mp4", 5_000_000),
    )
  }

  @Test
  fun aNormalizeWithoutAMeasureFallsBackToOnePassLoudnorm() {
    val args = FfmpegArgs.volume(VolumePlan("normalize", 0.0, "copy", "mp4"), "in", "out.mp4", 1)
    assertEquals("loudnorm=I=-23:LRA=11:TP=-1.5", args[args.indexOf("-af") + 1])
  }

  @Test
  fun aGainReEncodesAPictureThatCannotBeCopiedWithTheHardwareEncoder() {
    assertEquals(
      listOf(
        "-hide_banner", "-y", "-i", "saf:2.mkv", "-map", "0:v:0", "-c:v", "h264_mediacodec", "-b:v", "4200000", "-pix_fmt", "yuv420p",
        "-map", "0:a:0", "-af", "volume=-3.5dB", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-map_metadata", "-1", "out.mp4",
      ),
      FfmpegArgs.volume(VolumePlan("gain", -3.5, "hw-h264", "mp4"), "saf:2.mkv", "out.mp4", 4_200_000),
    )
  }

  @Test
  fun aWholeNumberGainPrintsWithoutADecimalPoint() {
    val args = FfmpegArgs.volume(VolumePlan("gain", 6.0, null, "m4a"), "in", "out.m4a", 0)
    assertEquals("volume=6dB", args[args.indexOf("-af") + 1])
  }

  @Test
  fun soundOnlyVolumeDropsThePictureAndKeepsM4a() {
    assertEquals(
      listOf(
        "-hide_banner", "-y", "-i", "saf:3.m4a", "-vn", "-map", "0:a:0", "-af", "volume=2dB", "-c:a", "aac", "-b:a", "192k",
        "-map_metadata", "-1", "out.m4a",
      ),
      FfmpegArgs.volume(VolumePlan("gain", 2.0, null, "m4a"), "saf:3.m4a", "out.m4a", 0),
    )
  }

  @Test
  fun reverseRunsPictureAndSoundBackwards() {
    assertEquals(
      listOf(
        "-hide_banner", "-y", "-i", "saf:1.mp4", "-map", "0:v:0", "-vf", "reverse",
        "-c:v", "h264_mediacodec", "-b:v", "8000000", "-pix_fmt", "yuv420p",
        "-map", "0:a:0?", "-af", "areverse", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-map_metadata", "-1", "out.mp4",
      ),
      FfmpegArgs.reverse(ReversePlan(true, 65.0, "mp4"), "saf:1.mp4", "out.mp4", 8_000_000),
    )
  }

  @Test
  fun reverseWithoutSoundDropsTheAudio() {
    val args = FfmpegArgs.reverse(ReversePlan(false, 65.0, "mp4"), "in", "out.mp4", 1_000_000)
    assertEquals(
      listOf(
        "-hide_banner", "-y", "-i", "in", "-map", "0:v:0", "-vf", "reverse",
        "-c:v", "h264_mediacodec", "-b:v", "1000000", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", "-map_metadata", "-1", "out.mp4",
      ),
      args,
    )
  }

  @Test
  fun stabilizeUsesDeshakeWithMirroredEdgesAndKeepsTheSound() {
    assertEquals(
      listOf(
        "-hide_banner", "-y", "-i", "saf:1.mp4", "-map", "0:v:0", "-vf", "deshake=rx=64:ry=64:edge=mirror",
        "-c:v", "h264_mediacodec", "-b:v", "6000000", "-pix_fmt", "yuv420p",
        "-map", "0:a:0?", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-map_metadata", "-1", "out.mp4",
      ),
      FfmpegArgs.stabilize(StabilizePlan("most", 64, 65.0, "mp4"), "saf:1.mp4", "out.mp4", 6_000_000),
    )
  }

  @Test
  fun stabilizeRangeIsAlwaysOneThePhonesDeshakeAccepts() {
    assertEquals(listOf(16, 16, 32, 48, 64, 64), listOf(8, 16, 32, 40, 64, 200).map { FfmpegArgs.deshakeRange(it) })
    assertTrue(FfmpegArgs.stabilize(StabilizePlan("minimum", 8, 65.0, "mp4"), "i", "o.mp4", 1).contains("deshake=rx=16:ry=16:edge=mirror"))
  }

  @Test
  fun noPhoneCommandUsesTheMacEncoderOrAProgressPipe() {
    val all = listOf(
      FfmpegArgs.volume(VolumePlan("gain", 1.0, "hw-h264", "mp4"), "i", "o.mp4", 1),
      FfmpegArgs.reverse(ReversePlan(true, 65.0, "mp4"), "i", "o.mp4", 1),
      FfmpegArgs.stabilize(StabilizePlan("minimum", 8, 65.0, "mp4"), "i", "o.mp4", 1),
    ).flatten()
    assertEquals(emptyList<String>(), all.filter { it.contains("videotoolbox") || it == "-progress" || it == "pipe:1" })
  }

  private val stderr = "[Parsed_loudnorm_0 @ 0x1] \n{\n\t\"input_i\" : \"-31.45\",\n\t\"input_tp\" : \"-12.07\",\n\t\"input_lra\" : \"0.00\",\n" +
    "\t\"input_thresh\" : \"-41.45\",\n\t\"target_offset\" : \"0.33\"\n}\n"

  @Test
  fun theLoudnessMeasureIsReadFromTheEndOfTheLog() {
    assertEquals(measured, FfmpegArgs.parseLoudnorm(stderr))
    assertEquals(measured, FfmpegArgs.parseLoudnorm("frame=1 {not json}\n$stderr[out#0/null @ 0x2] video:0kB\n"))
  }

  @Test
  fun aMissingOrNonNumericFieldMeansNoMeasure() {
    assertNull(FfmpegArgs.parseLoudnorm("no measure here"))
    assertNull(FfmpegArgs.parseLoudnorm(stderr.replace("\t\"input_thresh\" : \"-41.45\",\n", "")))
    assertNull(FfmpegArgs.parseLoudnorm(stderr.replace("\"-31.45\"", "\"-inf\"")))
    assertNull(FfmpegArgs.parseLoudnorm("{ broken"))
  }
}
