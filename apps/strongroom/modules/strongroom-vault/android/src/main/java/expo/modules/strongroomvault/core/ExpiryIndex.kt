package expo.modules.strongroomvault.core

import java.time.DateTimeException
import java.time.LocalDate
import java.time.YearMonth
import java.time.temporal.ChronoUnit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

data class ExpiryItem(val kind: String, val label: String, val expiresOn: LocalDate)

object ExpiryIndex {
  const val CARD = "card"
  const val PASS = "pass"
  const val MAX_LABEL = 60
  private const val CARD_LABEL = "Card"
  private const val PASS_LABEL = "Pass"

  // One row per card with a month and year and per pass with an expiry date: kind, label and date only. Labels are the generic kind unless showNames.
  fun build(entries: Map<String, Entry>, showNames: Boolean): List<ExpiryItem> =
    entries.values.mapNotNull { e ->
      when (e) {
        is Entry.Card -> endOfMonth(e.expMonth, e.expYear)?.let { ExpiryItem(CARD, if (showNames) label(e.name, CARD_LABEL) else CARD_LABEL, it) }
        is Entry.Pass -> e.expiresOn?.let { ExpiryItem(PASS, if (showNames) label(e.name, PASS_LABEL) else PASS_LABEL, it) }
        else -> null
      }
    }.sortedWith(compareBy({ it.expiresOn }, { it.label }))

  fun endOfMonth(month: Int?, year: Int?): LocalDate? {
    if (month == null || year == null) return null
    val fullYear = if (year in 0..99) 2000 + year else year
    if (fullYear !in 2000..2999) return null
    return try {
      YearMonth.of(fullYear, month).atEndOfMonth()
    } catch (e: DateTimeException) {
      null
    }
  }

  fun row(item: ExpiryItem, today: LocalDate): Array<Any> =
    arrayOf(item.kind, item.label, item.expiresOn.toString(), ChronoUnit.DAYS.between(today, item.expiresOn))

  fun encode(items: List<ExpiryItem>): ByteArray = buildJsonArray {
    for (i in items) addJsonObject {
      put("kind", i.kind)
      put("label", i.label)
      put("expiresOn", i.expiresOn.toString())
    }
  }.toString().toByteArray(Charsets.UTF_8)

  fun decode(bytes: ByteArray?): List<ExpiryItem> {
    if (bytes == null) return emptyList()
    return try {
      Json.parseToJsonElement(String(bytes, Charsets.UTF_8)).jsonArray.map {
        val o = it.jsonObject
        ExpiryItem(o.string("kind"), o.string("label"), LocalDate.parse(o.string("expiresOn")))
      }
    } catch (e: IllegalArgumentException) {
      emptyList()
    } catch (e: DateTimeException) {
      emptyList()
    }
  }

  private fun label(name: String, fallback: String): String = name.trim().take(MAX_LABEL).ifEmpty { fallback }
}
