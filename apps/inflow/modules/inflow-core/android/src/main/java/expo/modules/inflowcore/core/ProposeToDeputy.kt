package expo.modules.inflowcore.core

import expo.modules.inflowcore.applink.AppLinkGuard
import expo.modules.inflowcore.applink.AppLinkGuard.ExtraSpec
import expo.modules.inflowcore.applink.AppLinkGuard.ExtraType
import expo.modules.inflowcore.applink.AppLinkGuard.ExtrasCheck
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.concurrent.CancellationException

data class ProposeReply(val resultCode: Int, val status: String?, val code: String?)

object ProposeToDeputy {
  const val ACTION = "com.haroon.deputy.action.PROPOSE_TASK"
  const val HANDED_OVER = "handed_over"
  const val CANCELLED = "cancelled"
  const val UNAVAILABLE = "unavailable"

  private const val RESULT_OK = -1   // Activity.RESULT_OK
  private const val STATUS_DONE = "done"

  fun outcome(reply: ProposeReply?): String =
    if (reply != null && reply.resultCode == RESULT_OK && reply.status == STATUS_DONE && reply.code == HANDED_OVER) HANDED_OVER else CANCELLED

  // The sender rule: nothing starts unless trusted() says yes; a refusal or a failed start is UNAVAILABLE, never a fallback or a chooser. Inline so launch may suspend.
  inline fun run(trusted: () -> Boolean, launch: () -> ProposeReply?): String {
    if (!trusted()) return UNAVAILABLE
    val reply = try {
      launch()
    } catch (e: CancellationException) {
      throw e
    } catch (e: RuntimeException) {
      return UNAVAILABLE
    }
    return outcome(reply)
  }
}

object ProposeTaskExtras {
  const val TASK_MAX = 300
  const val CONTEXT_MAX = 2000
  const val PAYEE_MAX = 80

  val SPEC = mapOf(
    "task" to ExtraSpec(ExtraType.STRING, max = TASK_MAX, required = true),
    "context" to ExtraSpec(ExtraType.STRING, max = CONTEXT_MAX),
    "apps" to ExtraSpec(ExtraType.STRING_ARRAY, max = 20),
    "ref" to ExtraSpec(ExtraType.LONG),
  )

  const val BILL_TASK = "Help me pay this bill. The bill details are in the quoted text."

  private val DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)

  fun cleanPayee(raw: String?): String? =
    raw?.replace(Regex("\\s+"), " ")?.filterNot { Character.isISOControl(it) }?.trim()?.take(PAYEE_MAX)
      ?.let { if (it.isNotEmpty() && it.last().isHighSurrogate()) it.dropLast(1) else it }?.trim()?.takeIf { it.isNotEmpty() }

  fun billContext(payee: String?, dueAt: Long?, zone: ZoneId): String =
    listOfNotNull(
      cleanPayee(payee)?.let { "Payee: $it." },
      dueAt?.let { "Due: ${DAY.format(Instant.ofEpochMilli(it).atZone(zone))}." },
    ).joinToString(" ").take(CONTEXT_MAX)

  fun forBill(suggestionId: Long, payee: String?, dueAt: Long?, zone: ZoneId): Map<String, Any>? {
    val ctx = billContext(payee, dueAt, zone)
    val extras = buildMap<String, Any> {
      put("task", BILL_TASK)
      if (ctx.isNotEmpty()) put("context", ctx)
      put("ref", suggestionId)
    }
    return (AppLinkGuard.validateExtras(SPEC, extras) as? ExtrasCheck.Ok)?.extras
  }
}
