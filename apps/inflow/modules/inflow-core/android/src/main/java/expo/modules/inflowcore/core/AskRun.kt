package expo.modules.inflowcore.core

import java.time.ZoneId

class AskReply(val answer: String?, val error: String?, val from: Long = 0, val to: Long = 0, val items: Int = 0, val txns: Int = 0)

// R29, R10: the plan and the answer both go to AI hub. Health text is read only through [health], which the caller builds from the owner's Ask switch, so with the switch off none exists.
class AskRun(
  private val ai: TextAi,
  private val spend: (AiReply) -> Unit,
  private val capReached: () -> Boolean,
  private val apps: () -> List<Pair<String, String>>,
  private val items: (plan: AskPlan, pkgs: List<String>) -> List<AskItem>,
  private val txns: (plan: AskPlan) -> List<Txn>,
  private val health: (from: Long, to: Long) -> HealthForAsk?,
  private val now: () -> Long,
  private val zone: ZoneId,
) {
  fun run(question: String): AskReply = try {
    answer(question)
  } catch (e: AiError) {
    AskReply(null, if (e.kind == AiError.Kind.TIMEOUT) "The AI took too long to answer. Try again." else e.message)
  }

  private fun answer(question: String): AskReply {
    if (capReached()) return AskReply(null, AiRun.CAP_REACHED)
    val t = now()
    // R44: only SMS and email apps are offered to the plan, so WhatsApp and the rest never even appear in a request.
    val eligible = apps()
    val planReply = ai.complete(Ask.planSystem(), Ask.planUser(question, eligible, t, zone))
    spend(planReply)
    val plan = Ask.parsePlan(planReply.text, t, zone)
    if (capReached()) return AskReply(null, AiRun.CAP_REACHED)
    // A package the plan made up is not an app of ours; if none is left, the whole range is searched.
    val found = items(plan, plan.pkgs.filter { p -> eligible.any { it.first == p } })
    val money = if (plan.money) txns(plan) else emptyList()
    val h = health(plan.from, plan.to)
    val (sentItems, sentTxns) = Ask.fit(found, money, zone)   // the newest that fit: a bigger request is refused by the provider
    val answer = ai.complete(Ask.answerSystem(h != null), Ask.answerUser(question, sentItems, sentTxns, t, zone, h, found.size - sentItems.size, money.size - sentTxns.size))
    spend(answer)
    return AskReply(answer.text.trim(), null, plan.from, plan.to, sentItems.size, sentTxns.size)
  }
}
