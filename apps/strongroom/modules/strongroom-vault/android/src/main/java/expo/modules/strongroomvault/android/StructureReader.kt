package expo.modules.strongroomvault.android

import android.app.assist.AssistStructure
import android.view.View
import android.view.autofill.AutofillId
import expo.modules.strongroomvault.core.FieldNode

internal class ReadStructure(
  val pkg: String,
  val nodes: List<FieldNode>,
  val ids: List<AutofillId>,
  val values: List<String?>,
  val webDomain: String?,
  val webScheme: String?,
)

internal object StructureReader {
  // shortcut: text fields only, so a <select> or spinner expiry is never filled; add list values when a card form needs them.
  fun read(structure: AssistStructure): ReadStructure {
    val nodes = mutableListOf<FieldNode>()
    val ids = mutableListOf<AutofillId>()
    val values = mutableListOf<String?>()
    var webDomain: String? = null
    var webScheme: String? = null
    // Iterative, with each node's nearest web domain: a hostile app can nest views deep enough to overflow a recursive walk.
    val stack = ArrayDeque<Pair<AssistStructure.ViewNode, String?>>()
    for (i in structure.windowNodeCount - 1 downTo 0) stack.addLast(structure.getWindowNodeAt(i).rootViewNode to null)
    while (stack.isNotEmpty()) {
      val (node, inherited) = stack.removeLast()
      val own = node.webDomain?.takeIf { it.isNotEmpty() }
      if (own != null && webDomain == null) {
        webDomain = own
        webScheme = node.webScheme?.takeIf { it.isNotEmpty() }
      }
      val domain = own ?: inherited
      val id = node.autofillId
      if (id != null && node.autofillType == View.AUTOFILL_TYPE_TEXT) {
        val html = node.htmlInfo?.attributes.orEmpty().associate { it.first to it.second }
        nodes += FieldNode(
          index = ids.size,
          hints = node.autofillHints?.toList().orEmpty(),
          inputType = node.inputType,
          htmlType = html["type"],
          htmlAutocomplete = html["autocomplete"],
          htmlName = html["name"],
          idEntry = node.idEntry,
          hintText = node.hint,
          webDomain = domain,
        )
        ids += id
        values += node.autofillValue?.takeIf { it.isText }?.textValue?.toString()
      }
      for (c in node.childCount - 1 downTo 0) stack.addLast(node.getChildAt(c) to domain)
    }
    return ReadStructure(structure.activityComponent.packageName, nodes, ids, values, webDomain, webScheme)
  }
}
