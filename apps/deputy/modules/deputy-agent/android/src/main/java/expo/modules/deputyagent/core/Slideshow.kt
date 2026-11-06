package expo.modules.deputyagent.core

data class Photo(val id: Long, val name: String, val added: Long, val width: Int, val height: Int)

data class Picked(val photos: List<Photo>, val missing: List<String>)

object Slideshow {
  const val MAX_PHOTOS = 30
  const val FADE_US = 400_000L
  const val SAVED = "Saved "

  // Drive saves a repeat download as "name (1).jpg" (phone, 2026-11-04) while the model knows Drive's name, so the
  // newest of a file and its copies is the one just downloaded; only a name that is itself a copy matches exactly.
  private val COPY = Regex("""\s\(\d+\)$""")

  fun pick(names: List<String>, library: List<Photo>): Picked {
    val photos = mutableListOf<Photo>()
    val missing = mutableListOf<String>()
    for (name in names) {
      val namesCopy = COPY.containsMatchIn(name.trim().substringBeforeLast('.'))
      val exact = if (namesCopy) library.filter { it.name.equals(name.trim(), ignoreCase = true) } else emptyList()
      val found = exact.ifEmpty { library.filter { stem(it.name) == stem(name) } }.maxByOrNull { it.added }
      if (found == null) missing += name else if (photos.none { it.id == found.id }) photos += found
    }
    return Picked(photos, missing)
  }

  fun prefix(name: String) = name.trim().substringBeforeLast('.').replace(COPY, "")

  private fun stem(name: String) = prefix(name).lowercase()

  // The model lost count of its Drive downloads and fetched two files three times each (phone, 2026-11-05).
  fun arrivals(names: List<String>): String {
    val first = names.distinctBy(::stem)
    val again = names.toMutableList().apply { first.forEach { remove(it) } }
    val repeats = if (again.isEmpty()) "" else " Downloaded again, so not needed: ${again.joinToString()}. Don't download a photo twice."
    return "Photos added to the phone during this task, ${first.size} different: ${first.joinToString()}.$repeats\n"
  }

  fun frame(photos: List<Photo>): Pair<Int, Int> {
    val known = photos.filter { it.width > 0 && it.height > 0 }
    val wide = known.count { it.width > it.height }
    return if (wide * 2 > known.size) 1920 to 1080 else 1080 to 1920
  }

  // Every photo lasts eachUs, so the remainder is the time within the current photo whether Media3's timestamps are per item or overall.
  fun fade(timeUs: Long, eachUs: Long): Float {
    val t = timeUs % eachUs
    return (minOf(t, eachUs - t).toFloat() / FADE_US).coerceIn(0f, 1f)
  }
}
