package expo.modules.designmedia.core

import java.text.Normalizer
import java.util.Locale
import java.util.regex.Pattern
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// CLIP's byte-level BPE (OpenAI's simple_tokenizer), checked against the Python reference in tokens.json.
class ClipTokenizer(private val vocab: Map<String, Int>, merges: List<Pair<String, String>>) {
  private val ranks: Map<Pair<String, String>, Int> = merges.withIndex().associate { (i, p) -> p to i }
  private val cache = HashMap<String, List<Int>>()

  fun encode(text: String): IntArray {
    val clean = Normalizer.normalize(text, Normalizer.Form.NFC).replace(WHITESPACE, " ").lowercase(Locale.ROOT)
    val ids = ArrayList<Int>()
    val m = PIECE.matcher(clean)
    while (m.find() && ids.size < MAX_TEXT) ids += bpe(m.group())
    return (listOf(START) + ids.take(MAX_TEXT) + END).toIntArray()
  }

  private fun bpe(piece: String): List<Int> = cache.getOrPut(piece) {
    val symbols = piece.toByteArray(Charsets.UTF_8).map { BYTE_CHARS[it.toInt() and 0xFF].toString() }.toMutableList()
    symbols[symbols.lastIndex] += "</w>"
    while (symbols.size > 1) {
      var best = -1
      var bestRank = Int.MAX_VALUE
      for (i in 0 until symbols.size - 1) {
        val r = ranks[symbols[i] to symbols[i + 1]] ?: continue
        if (r < bestRank) { bestRank = r; best = i }
      }
      if (best < 0) break
      symbols[best] = symbols[best] + symbols[best + 1]
      symbols.removeAt(best + 1)
    }
    symbols.map { vocab[it] ?: END }
  }

  companion object {
    private const val START = 49406
    private const val END = 49407
    private const val MAX_TEXT = 75
    private val WHITESPACE = Regex("\\s+")
    private val PIECE = Pattern.compile("<\\|startoftext\\|>|<\\|endoftext\\|>|'s|'t|'re|'ve|'m|'ll|'d|[\\p{L}]+|[\\p{N}]|[^\\s\\p{L}\\p{N}]+")

    private val BYTE_CHARS: CharArray = run {
      val printable = (33..126) + (161..172) + (174..255)
      var extra = 0
      CharArray(256) { b -> if (b in printable) b.toChar() else (256 + extra++).toChar() }
    }

    fun fromJson(json: String): ClipTokenizer {
      val model = Json.parseToJsonElement(json).jsonObject.getValue("model").jsonObject
      val vocab = model.getValue("vocab").jsonObject.mapValues { it.value.jsonPrimitive.int }
      val merges = (model.getValue("merges") as JsonArray).map { m ->
        if (m is JsonArray) m[0].jsonPrimitive.content to m[1].jsonPrimitive.content
        else m.jsonPrimitive.content.split(' ', limit = 2).let { it[0] to it[1] }
      }
      return ClipTokenizer(vocab, merges)
    }
  }
}
