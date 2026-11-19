package expo.modules.notchisland.core

// Null unless the notification is a call (Notification.CATEGORY_CALL); a start time in the future or missing (0) counts as 0.
fun callElapsed(category: String?, startedAt: Long, now: Long): Long? =
  if (category != "call") null else if (startedAt <= 0) 0L else maxOf(0L, now - startedAt)

// The mockup's --go: the call time in the row and in the folded pill.
const val CALL_GREEN = 0xFF34D399.toInt()

// UNVERIFIED on a device (no live call probe): positions of the call notification's own Speaker and hang-up actions, -1 hides the button.
data class CallActions(val speaker: Int, val hangUp: Int)

private val SPEAKER_WORDS = listOf(
  "speaker", "speakerphone", "loudspeaker", "lautsprecher", "haut-parleur", "altavoz", "alto-falante", "altifalante",
  "vivavoce", "altoparlante", "динамик", "hoparlör", "مكبر", "स्पीकर", "扬声器", "免提", "擴音", "揚聲器", "スピーカー", "스피커", "pengeras",
)
private val HANG_UP_WORDS = listOf(
  "hang up", "end", "end call", "decline", "reject", "auflegen", "beenden", "ablehnen", "raccrocher", "refuser", "colgar",
  "rechazar", "finalizar", "terminar", "desligar", "recusar", "encerrar", "riaggancia", "termina", "rifiuta", "завершить",
  "отклонить", "сбросить", "kapat", "reddet", "bitir", "إنهاء", "رفض", "काटें", "समाप्त", "挂断", "拒绝", "掛斷", "拒絕",
  "切断", "終了", "拒否", "종료", "거절", "akhiri", "tolak", "tutup",
)

fun callActions(titles: List<String?>): CallActions {
  val speaker = titles.indexOfFirst { titleMatches(it, SPEAKER_WORDS) }
  return CallActions(speaker, titles.indices.firstOrNull { it != speaker && titleMatches(titles[it], HANG_UP_WORDS) } ?: -1)
}

// ASCII words must stand alone, so "end" never matches "Send" or "Weekend"; other scripts match inside the title.
internal fun titleMatches(title: String?, words: List<String>): Boolean {
  val t = title?.lowercase(java.util.Locale.ROOT) ?: return false
  return words.any { w -> if (w.all { it.code < 128 }) Regex("(?<!\\p{L})" + Regex.escape(w) + "(?!\\p{L})").containsMatchIn(t) else w in t }
}
