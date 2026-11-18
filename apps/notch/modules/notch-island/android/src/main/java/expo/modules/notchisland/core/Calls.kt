package expo.modules.notchisland.core

// Null unless the notification is a call (Notification.CATEGORY_CALL); a start time in the future counts as 0.
fun callElapsed(category: String?, startedAt: Long, now: Long): Long? =
  if (category == "call") maxOf(0L, now - startedAt) else null

// Positions in the call notification's action list, verified on the phone in Task 10. -1 hides the button.
const val SPEAKER_ACTION = -1
const val HANGUP_ACTION = -1

fun speakerAvailable(actionCount: Int, index: Int = SPEAKER_ACTION): Boolean = index in 0 until actionCount

fun endAvailable(actionCount: Int, index: Int = HANGUP_ACTION): Boolean = index in 0 until actionCount
