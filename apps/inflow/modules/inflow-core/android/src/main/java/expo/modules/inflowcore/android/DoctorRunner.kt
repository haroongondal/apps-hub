package expo.modules.inflowcore.android

import android.content.Context
import android.util.Log
import expo.modules.inflowcore.core.AiError
import expo.modules.inflowcore.core.AiReply
import expo.modules.inflowcore.core.DoctorInclude
import expo.modules.inflowcore.core.DoctorPayload
import expo.modules.inflowcore.core.DoctorRange
import expo.modules.inflowcore.core.TextAi
import java.time.ZoneId

// V4, R2 and R12: only on the owner's tap, only through AI hub, only the text whose hash the owner saw. Nothing here logs the payload or the reply.
class DoctorRunner(
  private val payload: (DoctorRange, DoctorInclude) -> DoctorPayload,
  private val ai: TextAi,
  private val capReached: () -> Boolean,
  private val spend: (AiReply) -> Unit,
) {
  fun preview(fromDay: String, toDay: String, include: Map<String, Any?>): Map<String, Any?> {
    val range = DoctorRange.parse(fromDay, toDay).getOrElse { return previewOf(null, it.message) }
    val what = DoctorInclude.fromMap(include).getOrElse { return previewOf(null, it.message) }
    return previewOf(payload(range, what), null)
  }

  fun summarize(fromDay: String, toDay: String, include: Map<String, Any?>, hash: String): Map<String, Any?> {
    val range = DoctorRange.parse(fromDay, toDay).getOrElse { return reply(null, it.message) }
    val what = DoctorInclude.fromMap(include).getOrElse { return reply(null, it.message) }
    if (capReached()) return reply(null, CAP)
    val p = payload(range, what)
    if (p.hash != hash) return reply(null, CHANGED)
    return try {
      val answer = ai.complete(DoctorPayload.SYSTEM, p.text)
      spend(answer)
      val summary = DoctorPayload.cleanReply(answer.text)
      if (summary.isEmpty()) reply(null, EMPTY) else reply(summary, null)
    } catch (e: AiError) {
      reply(null, copy(e))
    } catch (e: Exception) {
      Log.w(TAG, "summary failed: ${e.javaClass.simpleName}")
      reply(null, FAILED)
    }
  }

  private fun copy(e: AiError): String = when (e.kind) {
    AiError.Kind.TIMEOUT -> "The AI took too long to answer. Try again."
    AiError.Kind.BAD_REQUEST -> "AI hub couldn't take this request. Try fewer days or fewer sections."
    else -> e.message ?: FAILED
  }

  private fun previewOf(p: DoctorPayload?, error: String?) = mapOf("text" to p?.text, "hash" to p?.hash, "chars" to (p?.chars ?: 0), "error" to error)

  private fun reply(summary: String?, error: String?) = mapOf("summary" to summary, "error" to error)

  companion object {
    private const val TAG = "DoctorRunner"
    const val CAP = "Inflow reached today's AI spending limit. Nothing was sent. Try again tomorrow, or raise the limit in AI settings."
    const val CHANGED = "Your data changed since the preview. Review it again."
    const val EMPTY = "The AI sent back an empty summary. Try again."
    const val FAILED = "Inflow couldn't make the summary. Try again."

    fun of(ctx: Context, store: SqlItemStore): DoctorRunner {
      val cfg = AiConfig(store)
      return DoctorRunner(
        { r, i -> DoctorPayload.load(r, i, SqlHealthStore(store.db), SqlMedicineStore(store), SqlJournalStore(store), System.currentTimeMillis(), ZoneId.systemDefault()) },
        cfg.hub(ctx, foreground = true),
        cfg::capReached,
        cfg::spend,
      )
    }
  }
}
