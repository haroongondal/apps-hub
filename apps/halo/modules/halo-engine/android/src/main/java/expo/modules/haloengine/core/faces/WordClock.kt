package expo.modules.haloengine.core.faces

import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.Face
import expo.modules.haloengine.core.FaceInput
import expo.modules.haloengine.core.Line
import expo.modules.haloengine.core.accent
import expo.modules.haloengine.core.infoLine
import expo.modules.haloengine.core.main
import expo.modules.haloengine.core.scale
import expo.modules.haloengine.core.textBlock
import expo.modules.haloengine.core.withAlpha
import kotlin.math.min

private val HOUR_WORDS = listOf("twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven")

// Index = minute / 5; the clock reads the last five-minute mark, so 3:04 is still "three o'clock".
private val MINUTE_WORDS = listOf("", "five past", "ten past", "quarter past", "twenty past", "twenty-five past", "half past", "twenty-five to", "twenty to", "quarter to", "ten to", "five to")

/** Minute phrase and hour word, e.g. ("quarter past", "two") or ("", "three") for 3:00. */
fun wordParts(hour: Int, minute: Int): Pair<String, String> {
  val bucket = (minute / 5).coerceIn(0, 11)
  val next = bucket >= 7
  return MINUTE_WORDS[bucket] to HOUR_WORDS[(hour + if (next) 1 else 0) % 12]
}

fun wordTime(hour: Int, minute: Int): String {
  val (phrase, hourWord) = wordParts(hour, minute)
  return if (phrase.isEmpty()) "$hourWord o'clock" else "$phrase $hourWord"
}

/** The time in words ("quarter past two"), always 12-hour: the h24 option is ignored on purpose, words do not read well as "fourteen hundred". Seconds are ignored too. */
class WordClock : Face {
  override val id = "word-clock"
  override val name = "Word clock"
  override val supportsSeconds = false

  override fun draw(input: FaceInput, out: DrawList) = with(input) {
    val base = min(right - left, bottom - top) * 0.22f * scale
    val (phrase, hourWord) = wordParts(hour, minute)
    val info = Line(infoLine(), base * 0.16f, withAlpha(main, 0.75f), DrawList.REGULAR)
    val small = base * 0.42f
    if (phrase.isEmpty()) textBlock(out, Line(hourWord, base, main, DrawList.BOLD), Line("o'clock", small, accent, DrawList.REGULAR), info)
    else textBlock(out, Line(phrase, small, accent, DrawList.REGULAR), Line(hourWord, base, main, DrawList.BOLD), info)
  }
}
