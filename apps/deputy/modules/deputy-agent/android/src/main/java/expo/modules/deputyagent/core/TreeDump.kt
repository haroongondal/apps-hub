package expo.modules.deputyagent.core

data class DumpNode(
  val text: String?,
  val desc: String?,
  val hint: String?,
  val viewId: String?,
  val clickable: Boolean,
  val editable: Boolean,
  val scrollable: Boolean,
  val password: Boolean,
  val visible: Boolean,
)

object TreeDump {
  /** Safety rule 4: checked before any node is read, so Deputy's own screens never become text. */
  fun refusal(self: String, pkg: String): String? =
    if (pkg == self) "Deputy does not dump its own screens. Switch to another app before the countdown ends." else null

  fun format(pkg: String, nodes: List<DumpNode>): String {
    val lines = nodes.mapIndexedNotNull { i, n -> line(i, n) }
    return "<screen pkg=\"${esc(pkg)}\" nodes=\"${nodes.size}\" shown=\"${lines.size}\">\n" +
      lines.joinToString("") { it + "\n" } + "</screen>"
  }

  private fun line(i: Int, n: DumpNode): String? {
    // Safety rule 3: a password node keeps its role and loses its text and description.
    val text = if (n.password) null else n.text?.takeIf { it.isNotBlank() }
    val desc = if (n.password) null else n.desc?.takeIf { it.isNotBlank() }
    val hint = n.hint?.takeIf { it.isNotBlank() }
    val id = n.viewId?.takeIf { it.isNotBlank() }
    val labelled = n.text?.isNotBlank() == true || n.desc?.isNotBlank() == true || hint != null || id != null
    if (!n.visible || !(labelled || n.clickable || n.editable || n.scrollable)) return null
    val role = if (n.password) "password" else if (n.editable) "editable" else "text"
    return buildString {
      append("[$i] $role")
      if (text != null) append(" \"${esc(text)}\"")
      if (desc != null) append(" desc=\"${esc(desc)}\"")
      if (hint != null) append(" hint=\"${esc(hint)}\"")
      if (id != null) append(" id=\"${esc(id)}\"")
      if (n.clickable) append(" clickable")
      if (n.scrollable) append(" scrollable")
    }
  }

  private fun esc(s: String) =
    s.replace("\\", "\\\\").replace("\"", "\\\"").replace("<", "&lt;").replace("\r", "").replace("\n", "\\n")
}
