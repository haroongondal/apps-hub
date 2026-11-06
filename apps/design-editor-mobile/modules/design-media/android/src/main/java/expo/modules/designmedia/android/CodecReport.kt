package expo.modules.designmedia.android

import android.media.MediaCodecInfo
import android.media.MediaCodecInfo.CodecCapabilities
import android.media.MediaCodecInfo.EncoderCapabilities
import android.media.MediaCodecList

object CodecReport {
  private val MODES = listOf(
    "cq" to EncoderCapabilities.BITRATE_MODE_CQ,
    "vbr" to EncoderCapabilities.BITRATE_MODE_VBR,
    "cbr" to EncoderCapabilities.BITRATE_MODE_CBR,
    "cbr_fd" to EncoderCapabilities.BITRATE_MODE_CBR_FD,
  )

  fun list(): List<Map<String, Any?>> = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
    .flatMap { info -> info.supportedTypes.filter { it == "video/avc" || it == "video/hevc" }.map { describe(info, it) } }

  private fun describe(info: MediaCodecInfo, type: String): Map<String, Any?> {
    val caps = info.getCapabilitiesForType(type)
    val video = caps.videoCapabilities
    val modes = caps.encoderCapabilities
      ?.let { enc -> MODES.filter { enc.isBitrateModeSupported(it.second) }.map { it.first } }
      ?: emptyList()
    return mapOf(
      "name" to info.name,
      "mime" to type,
      "encoder" to info.isEncoder,
      "hardware" to info.isHardwareAccelerated,
      "vendor" to info.isVendor,
      "bitrateModes" to modes,
      "maxWidth" to video?.supportedWidths?.upper,
      "maxHeight" to video?.supportedHeights?.upper,
      "maxFps1080" to runCatching { video?.getSupportedFrameRatesFor(1920, 1080)?.upper }.getOrNull(),
      "hdrEditing" to caps.isFeatureSupported(CodecCapabilities.FEATURE_HdrEditing),
    )
  }
}
