package expo.modules.strongroomvault.android

import android.app.assist.AssistStructure
import android.view.View
import android.view.autofill.AutofillId
import expo.modules.strongroomvault.core.FieldNode

internal class ReadStructure(val pkg: String, val nodes: List<FieldNode>, val ids: List<AutofillId>, val values: List<String?>)

internal object StructureReader {
  // shortcut: text fields only, so a <select> or spinner expiry is never filled; add list values when a card form needs them.
  fun read(structure: AssistStructure): ReadStructure {
    val nodes = mutableListOf<FieldNode>()
    val ids = mutableListOf<AutofillId>()
    val values = mutableListOf<String?>()
    // Iterative, with each node's nearest web domain and scheme: a hostile app can nest views deep enough to overflow a recursive walk.
    val stack = ArrayDeque<Triple<AssistStructure.ViewNode, String?, String?>>()
    for (i in structure.windowNodeCount - 1 downTo 0) stack.addLast(Triple(structure.getWindowNodeAt(i).rootViewNode, null, null))
    while (stack.isNotEmpty()) {
      val (node, inheritedDomain, inheritedScheme) = stack.removeLast()
      // A hidden field (or anything under a hidden view) is never detected or filled; a browser that misreports visibility gets no fill.
      if (node.visibility != View.VISIBLE) continue
      val own = node.webDomain?.takeIf { it.isNotEmpty() }
      val domain = own ?: inheritedDomain
      val scheme = if (own != null) node.webScheme?.takeIf { it.isNotEmpty() } else inheritedScheme
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
          webScheme = scheme,
        )
        ids += id
        values += node.autofillValue?.takeIf { it.isText }?.textValue?.toString()
      }
      for (c in node.childCount - 1 downTo 0) stack.addLast(Triple(node.getChildAt(c), domain, scheme))
    }
    return ReadStructure(structure.activityComponent.packageName, nodes, ids, values)
  }
}
