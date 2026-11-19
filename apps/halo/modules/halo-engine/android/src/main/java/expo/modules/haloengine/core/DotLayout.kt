package expo.modules.haloengine.core

data class DotMetrics(val dot: Float, val gap: Float, val labelGap: Float, val lineGap: Float)

/** dot null is the "+N" overflow text; x, y is the cell's top-left in px. */
data class DotCell(val dot: Dot?, val label: String?, val x: Float, val y: Float, val w: Float)

object DotLayout {
  const val PER_ROW = 4

  fun label(count: Int, counts: Boolean): String? = when {
    !counts || count < 2 -> null
    count > 9 -> "9+"
    else -> count.toString()
  }

  fun place(row: DotRow, counts: Boolean, right: Float, top: Float, m: DotMetrics, textW: (String) -> Float): List<DotCell> {
    val lines = row.dots.map<Dot, Pair<Dot?, String?>> { it to label(it.count, counts) }.chunked(PER_ROW).toMutableList()
    // "+N" ends the last line of dots rather than starting a line of its own.
    if (row.overflow > 0) {
      if (lines.isEmpty()) lines.add(emptyList())
      lines[lines.lastIndex] = lines.last() + (null to "+${row.overflow}")
    }
    val out = ArrayList<DotCell>()
    lines.forEachIndexed { line, cells ->
      val widths = cells.map { (dot, label) ->
        when {
          dot == null -> textW(label!!)
          label == null -> m.dot
          else -> m.dot + m.labelGap + textW(label)
        }
      }
      var x = right - widths.sum() - m.gap * (cells.size - 1)
      val y = top + line * (m.dot + m.lineGap)
      cells.forEachIndexed { i, (dot, label) ->
        out.add(DotCell(dot, label, x, y, widths[i]))
        x += widths[i] + m.gap
      }
    }
    return out
  }

  /** Ripple kinds: a dot that is new or whose count rose; none for the first row drawn, so a launch is quiet. */
  fun fresh(old: DotRow?, new: DotRow): Set<DotKind> {
    if (old == null) return emptySet()
    val before = old.dots.associate { it.kind to it.count }
    return new.dots.filter { it.count > (before[it.kind] ?: 0) }.map { it.kind }.toSet()
  }
}
