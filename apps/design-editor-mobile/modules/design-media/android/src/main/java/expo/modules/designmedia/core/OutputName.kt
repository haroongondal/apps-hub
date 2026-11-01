package expo.modules.designmedia.core

// Mirrors packages/media-core/src/names.ts. Size outputs only, as there.
fun outputName(inputName: String, exists: (String) -> Boolean): String {
  val dot = inputName.lastIndexOf('.')
  val stem = (if (dot > 0) inputName.substring(0, dot) else inputName)
    .replace(Regex("[\\\\/:*?\"<>|\u0000-\u001f]"), "_").trim().take(100).ifEmpty { "Video" }
  val base = "$stem (compressed)"
  var name = "$base.mp4"
  var n = 2
  while (exists(name)) {
    name = "$base $n.mp4"
    n++
  }
  return name
}
