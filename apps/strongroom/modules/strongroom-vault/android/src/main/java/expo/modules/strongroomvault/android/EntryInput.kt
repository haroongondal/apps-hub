package expo.modules.strongroomvault.android

import expo.modules.kotlin.exception.CodedException
import expo.modules.strongroomvault.core.Barcode
import expo.modules.strongroomvault.core.BarcodeResult
import expo.modules.strongroomvault.core.Entry
import expo.modules.strongroomvault.core.Matching
import expo.modules.strongroomvault.core.PassFormat
import expo.modules.strongroomvault.core.Site

internal object EntryInput {
  private const val BAD_SITE = "That website address isn't valid. Check it and try again."

  /** A login keeps the apps already stored for it: links are made only by autofill, never typed. */
  fun toEntry(input: Map<String, Any?>, stored: Entry?): Entry = when (val type = input["type"]) {
    "login" -> Entry.Login(
      name = input.text("name"),
      username = input.text("username"),
      password = input.text("password"),
      sites = (input["sites"] as? List<*> ?: emptyList<Any?>())
        .map { it as? String ?: throw IllegalArgumentException("sites must be strings") }
        .filter { it.isNotBlank() }
        .map { site(it) ?: throw CodedException("BAD_SITE", BAD_SITE, null) },
      apps = (stored as? Entry.Login)?.apps.orEmpty(),
      note = input.text("note"),
      updatedAt = 0,
    )
    "card" -> Entry.Card(
      name = input.text("name"),
      holder = input.text("holder"),
      number = input.text("number"),
      expMonth = (input["expMonth"] as? Number)?.toInt(),
      expYear = (input["expYear"] as? Number)?.toInt(),
      cvc = input.text("cvc"),
      note = input.text("note"),
      updatedAt = 0,
    )
    "note" -> Entry.Note(input.text("name"), input.text("text"), 0)
    "pass" -> pass(input)
    else -> throw IllegalArgumentException("unknown entry type $type")
  }

  // Encodes the code once here so a code the format can't draw is refused with its reason now, not when the owner opens the pass at a till.
  private fun pass(input: Map<String, Any?>): Entry.Pass {
    val name = input.text("name")
    if (name.isBlank()) throw CodedException("BAD_PASS", "Give the pass a name.", null)
    val code = input.text("code")
    val format = PassFormat.of(input.text("format")) ?: throw IllegalArgumentException("unknown pass format")
    (Barcode.encodeMatrix(code, format.id) as? BarcodeResult.Error)?.let { throw CodedException("BAD_PASS", it.message, null) }
    return Entry.Pass(name, code, format, input.text("note"), 0)
  }

  fun site(typed: String): Site? = typed.trim().let { Matching.siteFromUrl(if ("://" in it) it else "https://$it") }

  private fun Map<String, Any?>.text(key: String): String = this[key] as? String ?: throw IllegalArgumentException("$key is missing")
}
