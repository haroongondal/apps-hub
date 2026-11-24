package expo.modules.inflowcore.core

object PdfLayout {
  // Greedy word wrap; a word wider than the line is broken between characters (never inside a surrogate pair). Blank lines are kept.
  fun wrap(text: String, maxWidth: Float, measure: (String) -> Float): List<String> {
    val out = mutableListOf<String>()
    for (para in text.replace("\r\n", "\n").replace('\t', ' ').split('\n')) {
      var line = ""
      for (word in para.split(' ').filter(String::isNotEmpty)) {
        val joined = if (line.isEmpty()) word else "$line $word"
        if (measure(joined) <= maxWidth) {
          line = joined
          continue
        }
        if (line.isNotEmpty()) out += line
        line = word
        while (measure(line) > maxWidth) {
          var end = 0
          while (end < line.length) {
            val next = line.offsetByCodePoints(end, 1)
            if (end > 0 && measure(line.substring(0, next)) > maxWidth) break
            end = next
          }
          if (end == line.length) break
          out += line.substring(0, end)
          line = line.substring(end)
        }
      }
      out += line
    }
    return out
  }

  fun pages(lines: List<String>, firstPage: Int, otherPages: Int): List<List<String>> {
    require(firstPage >= 1 && otherPages >= 1)
    val out = mutableListOf(lines.take(firstPage))
    var i = firstPage
    while (i < lines.size) {
      out += lines.subList(i, minOf(lines.size, i + otherPages)).toList()
      i += otherPages
    }
    return out
  }
}
