package expo.modules.notchisland.core

// Null unless the notification is a call (Notification.CATEGORY_CALL); a start time in the future counts as 0.
fun callElapsed(category: String?, startedAt: Long, now: Long): Long? =
  if (category == "call") maxOf(0L, now - startedAt) else null
