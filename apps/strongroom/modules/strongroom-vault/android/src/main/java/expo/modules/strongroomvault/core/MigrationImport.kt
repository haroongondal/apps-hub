package expo.modules.strongroomvault.core

/**
 * The Google Authenticator export (DESIGN §15.5): Authenticator's "Export accounts"
 * shows batch QRs of `otpauth-migration://offline?data=…`, where `data` percent-decodes
 * to base64 of a protobuf MigrationPayload — up to ten OtpParameters per batch. Own
 * protobuf reader (own-code rule; the format is stable). Checked against a real export
 * (2026-11-17): top-level `version` is 2 there, every OtpParameters carries an unknown
 * trailing field 8, and field 1 of OtpParameters is the secret while field 2 is the
 * account name — the reader skips what it does not know, like `Otp.parse` does.
 */
object MigrationImport {
  class ImportError(message: String) : Exception(message)

  /** One entry as the batch carries it; the policy (bounds, HOTP) is applied later, in [review]. */
  class Params(
    val secret: ByteArray,
    /** The account label; often an address, sometimes `Issuer:account`. */
    val name: String?,
    val issuer: String?,
    /** The algorithm enum: 0 unspecified, 1 SHA1, 2 SHA256, 3 SHA512, 4 MD5. */
    val algorithm: Long,
    /** The digit-count enum: 0 unspecified, 1 six, 2 eight. */
    val digits: Long,
    /** The type enum: 0 unspecified, 1 HOTP, 2 TOTP. */
    val type: Long,
    /** HOTP's counter; meaningless for TOTP. */
    val counter: Long,
  )

  class Batch(val entries: List<Params>, val version: Long, val batchSize: Int, val batchIndex: Int)

  // Bounds keep a damaged or hostile payload from eating memory; real batches stay far inside them.
  private const val MAX_BATCH_ENTRIES = 100
  private const val MAX_BATCHES = 500
  private const val MAX_SECRET_BYTES = 128

  /** The format-level read of one batch QR. Throws [ImportError] on anything unreadable. */
  fun parse(uri: String): Batch {
    val trimmed = uri.trim()
    fun bad(why: String): Nothing = throw ImportError(why)
    val schemeEnd = trimmed.indexOf(':')
    if (schemeEnd <= 0 || !trimmed.take(schemeEnd).equals("otpauth-migration", ignoreCase = true)) {
      bad("This QR is not an Authenticator export code")
    }
    val rest = trimmed.substring(schemeEnd + 1).removePrefix("//")
    val queryStart = rest.indexOf('?')
    if (queryStart < 0) bad("This QR is not an Authenticator export code")
    val slash = rest.indexOf('/')
    val host = rest.take(if (slash in 0 until queryStart) slash else queryStart)
    if (!host.equals("offline", ignoreCase = true)) bad("This QR is not an Authenticator export code")

    var dataText: String? = null
    for (pair in rest.substring(queryStart + 1).split('&')) {
      val eq = pair.indexOf('=')
      if (eq > 0 && pair.take(eq).lowercase() == "data" && dataText == null) dataText = pair.substring(eq + 1)
    }
    val payload = base64(percentDecode(dataText ?: bad("This QR holds no export data")))
      ?: bad("The export data is not valid base64")
    if (payload.isEmpty()) bad("The export data is empty")

    val entries = ArrayList<Params>()
    var version = 0L
    var batchSize = 0L
    var batchIndex = 0L
    walk(payload) { field, value ->
      when (field) {
        1L -> entries += params(bytes(value))
        2L -> version = number(value)
        3L -> batchSize = number(value)
        4L -> batchIndex = number(value)
        else -> {} // unknown fields are skipped (the real export carries one on every entry)
      }
    }
    if (entries.size > MAX_BATCH_ENTRIES) bad("This batch holds too many entries to be real")
    if (batchSize < 1 || batchSize > MAX_BATCHES) bad("The export names an impossible batch count")
    if (batchIndex < 0 || batchIndex >= batchSize) bad("This batch is out of the export's range")
    return Batch(entries, version, batchSize.toInt(), batchIndex.toInt())
  }

  /** One OtpParameters message. */
  private fun params(msg: ByteArray): Params {
    fun bad(why: String): Nothing = throw ImportError(why)
    var secret: ByteArray? = null
    var name: String? = null
    var issuer: String? = null
    var algorithm = 0L
    var digits = 0L
    var type = 0L
    var counter = 0L
    walk(msg) { field, value ->
      when (field) {
        1L -> (bytes(value)).let {
          if (it.size > MAX_SECRET_BYTES) bad("A code's key is too long to be real")
          secret = it
        }
        2L -> name = utf8(bytes(value))
        3L -> issuer = utf8(bytes(value))
        4L -> algorithm = number(value)
        5L -> digits = number(value)
        6L -> type = number(value)
        7L -> counter = number(value)
        else -> {}
      }
    }
    return Params(
      secret ?: bad("A code entry carries no key"),
      name,
      issuer,
      algorithm, digits, type, counter,
    )
  }

  // --- protobuf wire format -------------------------------------------------------------

  /**
   * Walks one message, calling back per field with its number and value (a varint as
   * Long, a length-delimited field as ByteArray). Unknown fields — including the
   * fixed-size wire types 1 and 5, bounds checked — are skipped; damaged bytes and
   * varints that never end refuse.
   */
  private fun walk(msg: ByteArray, visit: (field: Long, value: Any) -> Unit) {
    var i = 0
    fun varint(from: Int): Pair<Long, Int> {
      var r = 0L
      var shift = 0
      var j = from
      while (j < msg.size) {
        val b = msg[j].toInt() and 0xFF
        j++
        r = r or ((b and 0x7F).toLong() shl shift)
        if (b and 0x80 == 0) return r to j
        shift += 7
        if (shift > 63) throw ImportError("The export data is not readable")
      }
      throw ImportError("The export data is not readable")
    }
    fun delimited(from: Int): Pair<ByteArray, Int> {
      val (len, after) = varint(from)
      // `msg.size - after` never goes negative or overflows, unlike `after + len`.
      if (len < 0 || len > msg.size - after) throw ImportError("The export data is not readable")
      val end = after + len.toInt()
      return msg.copyOfRange(after, end) to end
    }
    while (i < msg.size) {
      val (key, afterKey) = varint(i)
      val field = key ushr 3
      if (field <= 0) throw ImportError("The export data is not readable")
      when ((key and 7).toInt()) {
        0 -> {
          val (v, after) = varint(afterKey)
          visit(field, v)
          i = after
        }
        2 -> {
          val (bytes, after) = delimited(afterKey)
          visit(field, bytes)
          i = after
        }
        1 -> {
          if (afterKey + 8 > msg.size) throw ImportError("The export data is not readable")
          i = afterKey + 8
        }
        5 -> {
          if (afterKey + 4 > msg.size) throw ImportError("The export data is not readable")
          i = afterKey + 4
        }
        else -> throw ImportError("The export data is not readable")
      }
    }
  }

  private fun utf8(raw: ByteArray): String? = runCatching { String(raw, Charsets.UTF_8) }.getOrNull()?.takeIf { it.isNotBlank() }

  /** A length-delimited value on a known field; a varint there is damaged data, refused cleanly. */
  private fun bytes(value: Any): ByteArray = value as? ByteArray ?: throw ImportError("The export data is not readable")

  /** A varint on a known field; anything else is damaged data, refused cleanly. */
  private fun number(value: Any): Long = value as? Long ?: throw ImportError("The export data is not readable")

  /** Standard base64 first (the real export), then URL-safe; padding optional. */
  private fun base64(text: String): ByteArray? =
    listOf(java.util.Base64.getDecoder(), java.util.Base64.getUrlDecoder()).firstNotNullOfOrNull { dec ->
      runCatching { dec.decode(text + "=".repeat((4 - text.length % 4) % 4)) }.getOrNull()
    }

  /** %XX escapes only — `+` in base64 stays `+` (a query-string plus would corrupt the payload). */
  private fun percentDecode(text: String): String {
    if ('%' !in text) return text
    val out = StringBuilder(text.length)
    var i = 0
    while (i < text.length) {
      val c = text[i]
      if (c == '%' && i + 3 <= text.length) {
        val hex = text.substring(i + 1, i + 3).toIntOrNull(16)
        if (hex != null) {
          out.append(hex.toChar())
          i += 3
          continue
        }
      }
      out.append(c)
      i++
    }
    return out.toString()
  }

  // --- the review -----------------------------------------------------------------------

  /** A login as [review] sees it: the fields the attach decision and the vault write need. */
  class Existing(val id: String, val name: String, val username: String, val totp: String?)

  /** What happens to one imported code; the RN review list renders these. */
  sealed class Item {
    abstract val issuer: String?
    abstract val account: String?

    /** The code is added to a login already in the vault; [totp] is the URI the vault gains. */
    class Attach(val loginId: String, val loginName: String, val totp: String, override val issuer: String?, override val account: String?) : Item()

    /** A new login with the code and no password. */
    class Create(val loginName: String, val username: String, val totp: String, override val issuer: String?, override val account: String?) : Item()
  }

  class Review(
    val items: List<Item>,
    val created: Int,
    val attached: Int,
    val duplicates: Int,
    /** Counter-based (HOTP) codes the vault cannot hold. */
    val hotp: Int,
    /** Codes refused by the same bounds as a scanned QR. */
    val bad: Int,
  )

  /**
   * The import's shape: which code attaches to which login (issuer = login name and
   * account = username, both compared without case; a login that already holds a code
   * is never an attach target), which become new logins, and which are dropped — a
   * second copy of a code already held (here or in the vault) is a duplicate, a
   * counter-based code is skipped and counted, and anything the §15.1 bounds refuse
   * is counted with them.
   */
  fun review(batches: List<Batch>, existing: List<Existing>): Review {
    val items = ArrayList<Item>()
    var created = 0
    var attached = 0
    var duplicates = 0
    var hotp = 0
    var bad = 0
    val taken = HashSet<String>() // base32 secrets already taken into this import
    val vaultSecrets = existing.mapNotNull { e ->
      e.totp?.let { Otp.parse(it)?.let { t -> base32Of(t.secret) } }
    }.toHashSet()

    val ordered = batches.sortedBy { it.batchIndex }.flatMap { it.entries }
    for (p in ordered) {
      if (p.type == 1L) { hotp++; continue }
      val uri = uriOf(p)
      if (uri == null) { bad++; continue }
      val totp = Otp.parse(uri)
      if (totp == null) { bad++; continue }
      val key = base32Of(totp.secret)
      if (key in taken || key in vaultSecrets) { duplicates++; continue }
      taken += key

      // The parsed URI is the single source of truth: what the vault holds is what the
      // entry screen will show, so the attach match and the names come from it.
      val target = if (totp.issuer == null) null else existing.firstOrNull { e ->
        e.totp == null && e.name.trim().equals(totp.issuer, ignoreCase = true) && when {
          totp.account == null -> e.username.isBlank()
          else -> e.username.trim().equals(totp.account, ignoreCase = true)
        }
      }
      if (target != null) {
        items += Item.Attach(target.id, target.name, uri, totp.issuer, totp.account)
        attached++
      } else {
        val loginName = totp.issuer ?: totp.account ?: continue
        items += Item.Create(loginName, totp.account ?: "", uri, totp.issuer, totp.account)
        created++
      }
    }
    return Review(items, created, attached, duplicates, hotp, bad)
  }

  /**
   * The `otpauth://totp/` URI the vault stores for an entry — built the way a site's
   * QR would present it, so `Otp.parse` is the single validator of what we hold.
   * Migration has no period: TOTP here is always 30 s, which is `Otp.parse`'s default.
   */
  fun uriOf(p: Params): String? {
    val issuer = p.issuer?.trim()?.takeIf { it.isNotEmpty() }
    val name = p.name?.trim()?.takeIf { it.isNotEmpty() }
    if (issuer == null && name == null) return null
    val algorithm = when (p.algorithm) {
      0L, 1L -> null // SHA1, the default
      2L -> "SHA256"
      3L -> "SHA512"
      else -> return null // MD5 and anything unknown
    }
    val digits = when (p.digits) {
      0L, 1L -> null // six, the default
      2L -> "8"
      else -> return null
    }
    val label = when {
      issuer != null && name != null && name.length > issuer.length + 1 &&
        name.startsWith(issuer, ignoreCase = true) && name[issuer.length] == ':' -> name // already "Issuer:account"
      issuer != null -> "$issuer:" + (name ?: "")
      else -> name!!
    }
    val params = buildList {
      add("secret=" + base32Of(p.secret))
      algorithm?.let { add("algorithm=$it") }
      digits?.let { add("digits=$it") }
      issuer?.let { add("issuer=" + escape(it)) }
    }.joinToString("&")
    return "otpauth://totp/${escape(label)}?$params"
  }

  /** RFC 4648 base32, uppercase with padding, what `Otp.parse` reads back. */
  internal fun base32Of(bytes: ByteArray): String {
    val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    val out = StringBuilder((bytes.size * 8 + 4) / 5)
    var buffer = 0
    var bits = 0
    for (b in bytes) {
      buffer = (buffer shl 8) or (b.toInt() and 0xFF)
      bits += 8
      while (bits >= 5) {
        bits -= 5
        out.append(alphabet[(buffer ushr bits) and 31])
      }
    }
    if (bits > 0) out.append(alphabet[(buffer shl (5 - bits)) and 31])
    while (out.length % 8 != 0) out.append('=')
    return out.toString()
  }

  /** Percent-encode a URI part by UTF-8 bytes; unreserved characters stay literal. */
  internal fun escape(text: String): String = buildString {
    for (b in text.toByteArray(Charsets.UTF_8)) {
      val c = b.toInt() and 0xFF
      when {
        c in 'A'.code..'Z'.code || c in 'a'.code..'z'.code || c in '0'.code..'9'.code ||
          c == '-'.code || c == '.'.code || c == '_'.code || c == '~'.code -> append(c.toChar())
        else -> append('%').append(String.format("%02X", c))
      }
    }
  }
}
