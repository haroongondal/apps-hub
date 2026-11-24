package expo.modules.inflowcore.android

import android.util.Log
import expo.modules.inflowcore.core.AiError
import expo.modules.inflowcore.core.AiModels
import expo.modules.inflowcore.core.DoctorInclude
import expo.modules.inflowcore.core.DoctorPayload
import expo.modules.inflowcore.core.DoctorRange
import expo.modules.inflowcore.core.HttpReply
import expo.modules.inflowcore.core.OpenAiCompatProvider
import java.time.ZoneId

// V4, R2 and R12: only on the owner's tap, only to Groq with the owner's Groq key, only the text whose hash the owner saw. Nothing here logs the payload, the reply or a key.
class DoctorRunner(
  private val payload: (DoctorRange, DoctorInclude) -> DoctorPayload,
  private val groqKeys: () -> List<String>,
  private val capReached: () -> Boolean,
  private val spend: (Double) -> Unit,
  private val post: (url: String, headers: Map<String, String>, body: String) -> HttpReply,
) {
  fun preview(fromDay: String, toDay: String, include: Map<String, Any?>): Map<String, Any?> {
    val range = DoctorRange.parse(fromDay, toDay).getOrElse { return previewOf(null, it.message) }
    val what = DoctorInclude.fromMap(include).getOrElse { return previewOf(null, it.message) }
    return previewOf(payload(range, what), null)
  }

  fun summarize(fromDay: String, toDay: String, include: Map<String, Any?>, hash: String): Map<String, Any?> {
    val range = DoctorRange.parse(fromDay, toDay).getOrElse { return reply(null, it.message) }
    val what = DoctorInclude.fromMap(include).getOrElse { return reply(null, it.message) }
    val keys = groqKeys().filter { it.isNotBlank() }
    if (keys.isEmpty()) return reply(null, NO_KEY)
    if (capReached()) return reply(null, CAP)
    val p = payload(range, what)
    if (p.hash != hash) return reply(null, CHANGED)
    val known = AiModels.known(AiModels.GROQ_URL, MODEL)!!
    return try {
      val answer = OpenAiCompatProvider(AiModels.GROQ_URL, MODEL, keys, known.effort, post).complete(DoctorPayload.SYSTEM, p.text)
      spend(known.prices.cost(answer))
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
    AiError.Kind.TIMEOUT -> "Groq took too long to answer. Try again."
    AiError.Kind.AUTH -> "Groq refused your key. Check your Groq key in AI settings."
    AiError.Kind.BAD_REQUEST -> "Groq couldn't take this request. Try fewer days or fewer sections."
    AiError.Kind.OFFLINE, AiError.Kind.SERVER -> e.message ?: FAILED
  }

  private fun previewOf(p: DoctorPayload?, error: String?) = mapOf("text" to p?.text, "hash" to p?.hash, "chars" to (p?.chars ?: 0), "error" to error)

  private fun reply(summary: String?, error: String?) = mapOf("summary" to summary, "error" to error)

  companion object {
    private const val TAG = "DoctorRunner"
    const val MODEL = "openai/gpt-oss-120b"
    const val NO_KEY = "Add a Groq key in AI settings first. Nothing was sent."
    const val CAP = "Inflow reached today's AI spending limit. Nothing was sent. Try again tomorrow, or raise the limit in AI settings."
    const val CHANGED = "Your data changed since the preview. Review it again."
    const val EMPTY = "Groq sent back an empty summary. Try again."
    const val FAILED = "Inflow couldn't make the summary. Try again."

    fun of(store: SqlItemStore): DoctorRunner {
      val cfg = AiConfig(store)
      return DoctorRunner(
        { r, i -> DoctorPayload.load(r, i, SqlHealthStore(store.db), SqlMedicineStore(store), SqlJournalStore(store), System.currentTimeMillis(), ZoneId.systemDefault()) },
        { (cfg.keys(AiModels.GROQ_URL) + cfg.keys(AiModels.GROQ_URL.trimEnd('/'))).map { it.second }.distinct() },
        cfg::capReached,
        { usd -> store.addSpend(cfg.today(), usd) },
        { u, h, b -> AiHttp.post(u, h, b, AiHttp.REPORT_READ_MS) },
      )
    }
  }
}
