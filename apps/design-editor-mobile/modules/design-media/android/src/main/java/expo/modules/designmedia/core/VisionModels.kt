package expo.modules.designmedia.core

import java.io.File

// The pinned cut-out and upscale files the app's JS downloads; Kotlin only verifies and installs them (no network here).
object VisionModels {
  val U2NETP = ModelFile(
    "u2netp.onnx", "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx", 4_574_861L,
    "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8",
  )
  val MODNET = ModelFile(
    "modnet.onnx", "https://huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model.onnx",
    25_888_640L, "07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9",
  )
  val ESRGAN = ModelFile(
    "realesr-general-x4v3-t176.onnx",
    "https://apps-hub-store.haroonmukhtar4.workers.dev/models/1c1bda585a8b044760e807d4e454b0a2f4bf0c0f0096ff4d8046c422e54f5ce0",
    4_866_394L, "1c1bda585a8b044760e807d4e454b0a2f4bf0c0f0096ff4d8046c422e54f5ce0",
  )

  // Every list of tools (module, JS, page) comes from here; delete the person line to drop MODNet.
  val TOOLS: Map<String, ModelFile> = linkedMapOf(
    "person" to MODNET,
    "object" to U2NETP,
    "upscale" to ESRGAN,
  )

  fun tools(dir: File): List<Map<String, Any>> = TOOLS.map { (tool, m) ->
    mapOf("tool" to tool, "name" to m.name, "url" to m.url, "bytes" to m.bytes, "ready" to ClipModels.isReady(dir, m))
  }

  fun install(dir: File, name: String): Boolean {
    val model = TOOLS.values.firstOrNull { it.name == name } ?: return false
    return ClipModels.install(dir, model)
  }
}
