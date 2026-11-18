package expo.modules.strongroomvault.core

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** A parsed `otpauth://totp/` URI, validated at construction (DESIGN §15.1). */
class TotpUri internal constructor(
  /** The URI exactly as it was scanned; the vault stores this string. */
  val raw: String,
  val secret: ByteArray,
  val algorithm: Otp.Digest,
  val digits: Int,
  val period: Int,
  /** From the `issuer` parameter, else the label's prefix. */
  val issuer: String?,
  /** The label's account part, if any. */
  val account: String?,
) {
  override fun toString() = "TotpUri(issuer=$issuer, account=$account, algorithm=$algorithm, digits=$digits, period=$period, secret=***)"
}

/**
 * TOTP (RFC 6238) and the `otpauth://totp/` URIs that carry its secrets.
 * Own code: HMAC through javax.crypto, RFC 4226 dynamic truncation, RFC 4648
 * base32. The parse bounds are DESIGN §15.1; every failure is refused with a
 * message the scan screen can show.
 */
object Otp {
  enum class Digest(internal val macName: String) {
    SHA1("HmacSHA1"), SHA256("HmacSHA256"), SHA512("HmacSHA512");

    companion object {
      fun of(s: String): Digest? = entries.firstOrNull { it.name.equals(s, ignoreCase = true) }
    }
  }

  const val MIN_SECRET_BYTES = 10 // 80 bits
  const val MAX_SECRET_BYTES = 64 // 512 bits
  const val MIN_PERIOD = 15
  const val MAX_PERIOD = 120

  private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

  /** Null when [uri] is not a valid TOTP URI; [refusal] says why. */
  fun parse(uri: String): TotpUri? = try {
    checked(uri)
  } catch (e: IllegalArgumentException) {
    null
  }

  /** Why [uri] is refused, or null when it parses. The scan screen shows this. */
  fun refusal(uri: String): String? = try {
    checked(uri)
    null
  } catch (e: IllegalArgumentException) {
    e.message
  }

  private fun checked(uri: String): TotpUri {
    fun bad(why: String): Nothing = throw IllegalArgumentException(why)
    val trimmed = uri.trim()
    val schemeEnd = trimmed.indexOf(':')
    if (schemeEnd <= 0 || !trimmed.take(schemeEnd).equals("otpauth", ignoreCase = true)) {
      bad("This QR is not an authenticator code")
    }
    val rest = trimmed.substring(schemeEnd + 1).removePrefix("//")
    val typeEnd = rest.indexOf('/')
    if (typeEnd < 0) bad("This QR is not an authenticator code")
    val type = rest.take(typeEnd)
    if (type.equals("hotp", ignoreCase = true)) bad("Counter-based codes are not supported")
    if (!type.equals("totp", ignoreCase = true)) bad("This QR is not an authenticator code")

    val body = rest.substring(typeEnd + 1)
    val queryStart = body.indexOf('?')
    if (queryStart < 0) bad("The QR holds no secret key")

    var secretText: String? = null
    var algorithm: Digest? = null
    var digitsText: Int? = null
    var periodText: Int? = null
    var issuerParam: String? = null
    for (pair in body.substring(queryStart + 1).split('&')) {
      if (pair.isEmpty()) continue
      val eq = pair.indexOf('=')
      val key = if (eq < 0) pair else pair.take(eq)
      val value = if (eq < 0) "" else percentDecode(pair.substring(eq + 1))
      when (key.lowercase()) {
        "secret" -> if (secretText == null) secretText = value.replace(" ", "")
        "algorithm" -> if (algorithm == null) algorithm = value.takeIf { it.isNotEmpty() }?.let { Digest.of(it) ?: bad("The QR names an algorithm Strongroom doesn't know") }
        "digits" -> if (digitsText == null) digitsText = value.toIntOrNull() ?: bad("The QR's digit count is not a number")
        "period" -> if (periodText == null) periodText = value.toIntOrNull() ?: bad("The QR's period is not a number")
        "issuer" -> if (issuerParam == null) issuerParam = value.trim().ifEmpty { null }
        else -> {} // unknown parameters are ignored (§15.1)
      }
    }
    val label = percentDecode(body.take(queryStart)).trim()
    var issuer = issuerParam
    if (issuer == null && ':' in label) issuer = label.take(label.indexOf(':')).trim().ifEmpty { null }

    val secret = base32(secretText ?: bad("The QR holds no secret key")) ?: bad("The QR's secret is not valid base32")
    if (secret.size < MIN_SECRET_BYTES) bad("The secret is too short (needs at least 80 bits)")
    if (secret.size > MAX_SECRET_BYTES) bad("The secret is too long (at most 512 bits)")
    val digits = digitsText ?: 6
    val period = periodText ?: 30
    if (digits != 6 && digits != 8) bad("Digits must be 6 or 8")
    if (period < MIN_PERIOD || period > MAX_PERIOD) bad("The period must be $MIN_PERIOD–$MAX_PERIOD seconds")

    val account = if (':' in label) label.substring(label.indexOf(':') + 1).trim().ifEmpty { null } else label.trim().ifEmpty { null }
    return TotpUri(uri, secret, algorithm ?: Digest.SHA1, digits, period, issuer, account)
  }

  /** The 6 or 8 digit code for [unixSeconds], e.g. "012345". */
  fun code(totp: TotpUri, unixSeconds: Long): String {
    val counter = unixSeconds / totp.period
    val mac = Mac.getInstance(totp.algorithm.macName)
    mac.init(SecretKeySpec(totp.secret, "RAW"))
    val message = ByteArray(8)
    for (i in 0 until 8) message[i] = (counter shr ((7 - i) * 8)).toByte()
    val hash = mac.doFinal(message)
    val offset = hash.last().toInt() and 0x0f
    val binary = ((hash[offset].toInt() and 0x7f) shl 24) or
      ((hash[offset + 1].toInt() and 0xff) shl 16) or
      ((hash[offset + 2].toInt() and 0xff) shl 8) or
      (hash[offset + 3].toInt() and 0xff)
    return (binary % POW10[totp.digits]).toString().padStart(totp.digits, '0')
  }

  /** Convenience for callers that hold the stored string: null only if it stopped parsing (it was validated on save). */
  fun code(uri: String, unixSeconds: Long): String? = parse(uri)?.let { code(it, unixSeconds) }

  /** A code and how long it stays valid — what the entry screen shows (§15.5). */
  data class State(val code: String, val secondsLeft: Int, val period: Int)

  /**
   * [code] at [unixSeconds] plus the seconds left before the period turns over:
   * a fresh period starts at the full period, the last second reads 1 (never 0).
   */
  fun state(totp: TotpUri, unixSeconds: Long): State =
    State(code(totp, unixSeconds), (totp.period - (unixSeconds % totp.period)).toInt(), totp.period)

  private val POW10 = intArrayOf(1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000)

  /** RFC 4648 base32: case-insensitive, `=` padding optional, whitespace ignored, non-canonical trailing bits discarded. */
  internal fun base32(text: String): ByteArray? {
    val chars = text.filter { !it.isWhitespace() && it != '=' }
    if (chars.isEmpty()) return null
    val out = ByteArray(chars.length * 5 / 8)
    var buffer = 0
    var bits = 0
    var next = 0
    for (c in chars) {
      val value = when (c) {
        in 'A'..'Z' -> c - 'A'
        in 'a'..'z' -> c - 'a'
        in '2'..'7' -> c - '2' + 26
        else -> return null
      }
      buffer = (buffer shl 5) or value
      bits += 5
      if (bits >= 8) {
        bits -= 8
        out[next++] = (buffer shr bits).toByte()
        buffer = buffer and ((1 shl bits) - 1)
      }
    }
    return out
  }

  /** Percent-decoding for the label and parameter values; `+` stays a plus and malformed escapes fail. */
  private fun percentDecode(text: String): String {
    if ('%' !in text) return text
    val bytes = ArrayList<Byte>(text.length)
    var i = 0
    while (i < text.length) {
      val c = text[i]
      if (c != '%') {
        bytes.add(c.code.toByte())
        i++
        continue
      }
      if (i + 2 >= text.length) throw IllegalArgumentException("This QR is malformed")
      val hex = text.substring(i + 1, i + 3).toIntOrNull(16) ?: throw IllegalArgumentException("This QR is malformed")
      bytes.add(hex.toByte())
      i += 3
    }
    return String(bytes.toByteArray(), Charsets.UTF_8)
  }
}
