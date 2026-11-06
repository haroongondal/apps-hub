package expo.modules.designmedia.core

private val UNSAFE = Regex("[\\\\/:*?\"<>|\u0000-\u001f]")

// Mirrors packages/media-core/src/names.ts: "<name> (<label>).<ext>", then "<name> (<label>) 2.<ext>".
fun outputName(inputName: String, label: String, ext: String, exists: (String) -> Boolean): String {
  val dot = inputName.lastIndexOf('.')
  val stem = (if (dot > 0) inputName.substring(0, dot) else inputName).replace(UNSAFE, "_").trim().take(100).ifEmpty { "Video" }
  val safeLabel = label.replace(UNSAFE, "_").trim().take(50)
  val base = if (safeLabel.isNotEmpty()) "$stem ($safeLabel)" else stem
  var name = "$base.$ext"
  var n = 2
  while (exists(name)) {
    name = "$base $n.$ext"
    n++
  }
  return name
}

// The label comes from the plan's tool (apps/design-editor/media.js LABELS); audio carries its track position.
fun outputLabel(plan: Plan): String = when (plan) {
  is SizePlan, is QualityPlan -> "compressed"
  is ClipPlan -> "clip"
  is ConvertPlan -> "converted"
  is FramePlan -> "frame"
  is VolumePlan -> "volume"
  is ReversePlan -> "reversed"
  is StabilizePlan -> "stabilized"
  is GifPlan, is AudioPlan, is ComposePlan -> ""
}

fun audioLabel(position: Int, language: String?): String {
  val tag = language?.takeIf { it != "und" && Regex("^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$").matches(it) }
  return listOfNotNull("audio", (position + 1).toString(), tag).joinToString(" ")
}

fun outputExt(plan: Plan): String = when (plan) {
  is SizePlan, is QualityPlan, is ReversePlan, is StabilizePlan, is ComposePlan -> "mp4"
  is GifPlan -> "gif"
  is ClipPlan -> plan.ext
  is AudioPlan -> plan.ext
  is ConvertPlan -> plan.ext
  is FramePlan -> plan.ext
  is VolumePlan -> plan.ext
}
