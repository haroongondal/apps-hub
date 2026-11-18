package expo.modules.inflowcore.core

object Amounts {
  // Commas are dropped wherever they sit, so lakh grouping ("1,50,000") reads as one number.
  private val NUMBER = Regex("\\d+(?:,\\d+)*(?:\\.\\d+)?")

  /** Every number in the text as minor units. A number that is not a whole count of minor units, or does not fit a Long, is left out. */
  fun inText(text: String): Set<Long> = NUMBER.findAll(text).mapNotNull { minor(it.value) }.toSet()

  private fun minor(n: String): Long? {
    val whole = n.substringBefore('.').replace(",", "").toLongOrNull() ?: return null
    // More than two meaningful decimals is not money; skipping beats guessing.
    val frac = n.substringAfter('.', "").trimEnd('0')
    if (frac.length > 2 || whole > Long.MAX_VALUE / 100 - 1) return null
    return whole * 100 + frac.padEnd(2, '0').toLong()
  }
}
