package expo.modules.notchisland.core

// Null unless the notification is a call (Notification.CATEGORY_CALL); a start time in the future or missing (0) counts as 0.
fun callElapsed(category: String?, startedAt: Long, now: Long): Long? =
  if (category != "call") null else if (startedAt <= 0) 0L else maxOf(0L, now - startedAt)

// The mockup's --go: the call time in the row and in the folded pill.
const val CALL_GREEN = 0xFF34D399.toInt()

// Positions in the call notification's action list, verified on the phone in Task 10. -1 hides the button.
const val SPEAKER_ACTION = -1
const val HANGUP_ACTION = -1

fun speakerAvailable(actionCount: Int, index: Int = SPEAKER_ACTION): Boolean = index in 0 until actionCount

fun endAvailable(actionCount: Int, index: Int = HANGUP_ACTION): Boolean = index in 0 until actionCount
