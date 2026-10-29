package expo.modules.deputyagent.core

import kotlin.math.hypot

/** What the device read: every window's nodes in reading order (SPEC §5). */
data class Screen(
  val pkg: String,
  val app: String,
  val title: String?,
  val keyboardUp: Boolean,
  val viewport: Bounds,
  val nodes: List<NodeRef>,
  val unread: List<Area> = emptyList(),
)

/** A window on screen whose nodes aren't read: the keyboard, System UI. */
data class Area(val pkg: String, val bounds: Bounds)

/** `nodes` maps the indices in `text` to their elements, valid for this observation only. */
data class Observation(
  val text: String,
  val nodes: Map<Int, NodeRef>,
  val context: ScreenContext,
  val labelled: Int,
  val app: String,
  val viewport: Bounds,
  /** Every node read, by raw index, including dropped and own-window ones: for hit-tests and click targets, never sent. */
  val all: List<NodeRef>,
  private val clickIndex: List<Int>,
  val screenshotSafe: Boolean,
) {
  /** The node a tap on `all[i]` actually lands on: itself if clickable, else its nearest clickable ancestor. */
  fun clickTarget(i: Int): NodeRef = all[clickIndex[i]]

  fun hit(x: Int, y: Int): Int? = all.indices
    .filter { i -> all[i].visible && all[i].bounds.let { x in it.left..it.right && y in it.top..it.bottom } }
    .minByOrNull { i -> all[i].bounds.let { (it.right - it.left).toLong() * (it.bottom - it.top) } }
}

class ObservationBuilder(
  private val policy: Policy,
  private val selfLabel: String,
  private val maxNodes: Int = 150,
  private val maxChars: Int = 8_000,
) {
  fun build(pkg: String, read: () -> Screen): Observation? {
    if (!policy.preObserve(pkg)) return null
    val screen = read()
    if (!policy.preObserve(screen.pkg)) return null
    // Rule 2: the shade's rows all belong to System UI, whatever app posted them, so a blocked app's can't be left out.
    val shade = screen.pkg == SYSTEM_UI
    val (nodes, lifted) = if (shade) emptyList<NodeRef>() to emptySet() else liftChildLabels(screen.nodes)
    val lines = nodes.mapIndexedNotNull { i, n ->
      if (i !in lifted && policy.preObserve(n.pkg)) TreeDump.line(i, shorten(n))?.let { Triple(i, n, it) } else null
    }
    val cx = (screen.viewport.left + screen.viewport.right) / 2.0
    val cy = (screen.viewport.top + screen.viewport.bottom) / 2.0
    var chars = 0
    val kept = lines
      .sortedBy { (_, n) -> hypot((n.bounds.left + n.bounds.right) / 2.0 - cx, (n.bounds.top + n.bounds.bottom) / 2.0 - cy) }
      .filterIndexed { rank, (_, _, line) -> rank < maxNodes && (chars + line.length + 1 <= maxChars).also { if (it) chars += line.length + 1 } }
      .sortedBy { it.first }
    val keyboard = if (screen.keyboardUp) "up" else "down"
    val header = "<screen app=\"${TreeDump.esc(screen.app)}\" pkg=\"${TreeDump.esc(screen.pkg)}\" title=\"${TreeDump.esc(if (shade) SHADE else screen.title.orEmpty())}\" " +
      "keyboard=\"$keyboard\" nodes=\"${kept.size}\" dropped=\"${lines.size - kept.size}\">"
    return Observation(
      text = header + "\n" + kept.joinToString("") { it.third + "\n" } + "</screen>",
      nodes = kept.associate { (i, n) -> i to redact(n) },
      context = ScreenContext(screen.pkg, screen.title, screen.nodes.any { it.label?.contains(selfLabel, ignoreCase = true) == true }, screen.unread.map { it.bounds }),
      labelled = kept.count { it.second.label != null },
      app = screen.app,
      viewport = screen.viewport,
      all = nodes.map { if (policy.preObserve(it.pkg)) redact(it) else it.copy(text = null, desc = null, hint = null, viewId = null, childText = null) },
      clickIndex = clickIndex(nodes),
      screenshotSafe = (screen.nodes.map { it.pkg } + screen.unread.map { it.pkg }).all(policy::preObserve),
    )
  }

  private fun clickIndex(nodes: List<NodeRef>): List<Int> {
    val ancestors = ArrayDeque<Int>()
    return nodes.mapIndexed { i, n ->
      while (ancestors.isNotEmpty() && nodes[ancestors.last()].depth >= n.depth) ancestors.removeLast()
      (if (n.clickable) i else ancestors.lastOrNull { nodes[it].clickable } ?: i).also { ancestors.addLast(i) }
    }
  }

  private fun redact(n: NodeRef) = if (n.password) n.copy(text = null, desc = null) else n

  private fun shorten(n: NodeRef) = n.copy(text = n.text?.let(::cut), desc = n.desc?.let(::cut), childText = n.childText?.let(::cut))

  private fun cut(s: String) = if (s.length > MAX_FIELD) s.take(MAX_FIELD - 1) + "…" else s

  private companion object {
    const val MAX_FIELD = 2_000
    const val SHADE = "not read: the notification shade, lock screen or a system dialog. Press back"
  }

  /** Spike S4: a clickable row often has no text and its label sits in children; returns the rows and the children used. */
  private fun liftChildLabels(nodes: List<NodeRef>): Pair<List<NodeRef>, Set<Int>> {
    val out = nodes.toMutableList()
    val used = HashSet<Int>()
    for ((i, row) in nodes.withIndex()) {
      if (!row.clickable || row.password || row.label != null) continue
      val parts = ArrayList<String>()
      var nested = Int.MAX_VALUE
      var j = i + 1
      while (j < nodes.size && nodes[j].depth > row.depth) {
        val c = nodes[j]
        if (c.depth <= nested) nested = Int.MAX_VALUE
        when {
          c.depth > nested -> Unit
          c.clickable || c.editable || c.scrollable -> nested = c.depth
          c.visible && !c.password -> c.label?.let { parts += it; used += j }
        }
        j++
      }
      if (parts.isNotEmpty()) out[i] = row.copy(childText = parts.joinToString(", ").take(120))
    }
    return out to used
  }
}
