package expo.modules.inflowcore.core

import java.time.Instant
import java.time.ZoneId

/** Turns one AI result into at most one suggestion. Everything the model said is a hint: dates are checked here and the title is built from code. */
object SuggestionRules {
  private const val DAY_MS = 24 * 3_600_000L

  /** One reply per chat of one app: a number chat has the same key (`num:...`) in every app, so the package is part of it. */
  fun replyKey(pkg: String?, conversationKey: String): String = "reply:" + (pkg?.let { pickedChatKey(it, conversationKey) } ?: conversationKey)

  fun fromResult(r: AiResult, input: AiInput, conversationKey: String?, now: Long, zone: ZoneId, s: AutopilotSettings): Suggestion? {
    val sg = r.suggest ?: return null
    if (input.own) return null
    val kind = when (sg.type) {
      SuggestType.REPLY -> SuggestionKind.REPLY
      SuggestType.BILL -> SuggestionKind.BILL
      SuggestType.EVENT -> SuggestionKind.EVENT
    }
    if (kind !in s.kinds) return null
    val due = sg.dueAt
    val key = when (kind) {
      SuggestionKind.REPLY -> {
        if (r.importance == Importance.LOW) return null
        // A reply goes to a real person: a chat the owner picked, or an SMS from a phone number. A bank's short code or name ("8287", "HBL") never gets one.
        val picked = input.pickedOnly || (input.pkg != null && conversationKey != null && pickedChatKey(input.pkg, conversationKey) in s.pickedChats)
        if (!picked && !FastPath.isPerson(input.sender)) return null
        // A reply without a chat key is keyed by its item, so it still dedupes against itself only.
        conversationKey?.let { replyKey(input.pkg, it) } ?: "reply:item:${input.itemId}"
      }
      SuggestionKind.BILL -> {
        if (due == null || due < now - 3 * DAY_MS) return null
        // shortcut: the largest amount in the text is taken as the bill amount, upgrade when two same-amount bills fall on one day.
        "bill:${Amounts.inText(input.text).maxOrNull() ?: 0L}:${Instant.ofEpochMilli(due).atZone(zone).toLocalDate()}"
      }
      SuggestionKind.EVENT -> {
        if (due == null || due <= now) return null
        "event:$due:${sg.detail.lowercase()}"
      }
      SuggestionKind.MONEY -> return null
    }
    return Suggestion(
      id = 0, kind = kind, title = SuggestionTitle.of(kind, input.conversation ?: input.sender, due, now, zone),
      itemId = input.itemId, dueAt = due, dedupeKey = key, state = SuggestionState.WAITING,
      createdAt = now, updatedAt = now, expiresAt = expiryFor(kind, now, due),
    )
  }
}
