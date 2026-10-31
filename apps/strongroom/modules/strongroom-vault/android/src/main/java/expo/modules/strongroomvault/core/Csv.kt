package expo.modules.strongroomvault.core

object Csv {
  /** RFC 4180 records; drops a leading BOM, accepts CRLF, LF and lone CR. Throws IllegalArgumentException only for a quoted field that never ends. */
  fun parse(text: String): List<List<String>> {
    val s = text.removePrefix("\uFEFF")
    val rows = ArrayList<List<String>>()
    var cells = ArrayList<String>()
    val value = StringBuilder()
    var start = 0 // index where the current cell begins: a quote opens a quoted cell only there, anywhere else it is literal
    var inQuotes = false
    var i = 0
    while (i < s.length) {
      val c = s[i]
      when {
        inQuotes -> when {
          c != '"' -> value.append(c)
          s.getOrNull(i + 1) == '"' -> { value.append('"'); i++ }
          else -> inQuotes = false
        }
        c == '"' && i == start -> inQuotes = true
        c == ',' -> { cells.add(value.toString()); value.setLength(0); start = i + 1 }
        c == '\r' || c == '\n' -> {
          cells.add(value.toString())
          value.setLength(0)
          rows.add(cells)
          cells = ArrayList()
          if (c == '\r' && s.getOrNull(i + 1) == '\n') i++
          start = i + 1
        }
        else -> value.append(c)
      }
      i++
    }
    require(!inQuotes) { "a quoted field never ends" }
    if (cells.isNotEmpty() || start < s.length) {
      cells.add(value.toString())
      rows.add(cells)
    }
    return rows
  }
}
