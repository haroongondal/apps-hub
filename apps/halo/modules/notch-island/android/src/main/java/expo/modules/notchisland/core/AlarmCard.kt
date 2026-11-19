package expo.modules.notchisland.core

// snooze and dismiss are positions in the alarm notification's own action list; -1 hides that button.
data class AlarmSnapshot(val key: String, val title: String, val at: Long, val postedAt: Long, val snooze: Int, val dismiss: Int)

data class AlarmActions(val snooze: Int, val dismiss: Int)

object AlarmCard {
  private const val SEMANTIC_DELETE = 4

  private val SNOOZE = listOf(
    "snooze", "schlummern", "snoozen", "répéter", "rappel", "posponer", "repetir", "soneca", "adiar", "posticipa", "ripeti",
    "отложить", "повтор", "ertele", "غفوة", "स्नूज़", "稍后提醒", "贪睡", "再响", "スヌーズ", "다시 알림", "tunda",
  )
  private val DISMISS = listOf(
    "dismiss", "stop", "turn off", "verwerfen", "beenden", "ausschalten", "stopp", "arrêter", "ignorer", "désactiver",
    "descartar", "detener", "apagar", "parar", "desativar", "dispensar", "interrompi", "ignora", "disattiva",
    "отключить", "выключить", "остановить", "kapat", "durdur", "إيقاف", "تجاهل", "बंद", "खारिज", "关闭", "停止", "關閉",
    "解除", "止める", "해제", "끄기", "matikan", "hentikan", "abaikan",
  )

  fun ringing(category: String?, ongoing: Boolean, fullScreen: Boolean): Boolean = category == "alarm" && (ongoing || fullScreen)

  // Android has no semantic action for snooze, so DELETE is the only flag to prefer; then keywords; then, with two or more actions, the first two in order.
  fun actions(titles: List<String?>, semantics: List<Int> = emptyList()): AlarmActions {
    val snooze = titles.indexOfFirst { titleMatches(it, SNOOZE) }
    val dismiss = semantics.indexOf(SEMANTIC_DELETE).takeIf { it >= 0 && it != snooze && it < titles.size }
      ?: titles.indices.firstOrNull { it != snooze && titleMatches(titles[it], DISMISS) }
      ?: -1
    if (titles.size < 2) return AlarmActions(snooze, dismiss)
    val s = if (snooze >= 0) snooze else if (dismiss == 0) 1 else 0
    val d = if (dismiss >= 0) dismiss else if (s == 0) 1 else 0
    return AlarmActions(s, d)
  }

  fun pick(all: Collection<AlarmSnapshot>): AlarmSnapshot? = all.maxByOrNull { it.postedAt }

  fun show(enabled: Boolean, alarm: AlarmSnapshot?): Boolean = enabled && alarm != null

  fun title(raw: String?): String = raw?.replace(Regex("\\s+"), " ")?.trim()?.ifEmpty { null } ?: "Alarm"
}
