package expo.modules.noteboxcore.android

import android.app.Notification
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import expo.modules.noteboxcore.core.RawMessage
import expo.modules.noteboxcore.core.RawNotification

object RawFromSbn {
  fun from(sbn: StatusBarNotification, appLabel: String): RawNotification {
    val n = sbn.notification
    val extras = n.extras
    val messages = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n)?.messages.orEmpty().map { m ->
      RawMessage(m.person?.name?.toString(), m.text?.toString().orEmpty(), m.timestamp)
    }
    return RawNotification(
      pkg = sbn.packageName,
      appLabel = appLabel,
      key = sbn.key,
      postTime = sbn.postTime,
      ongoing = n.flags and (Notification.FLAG_ONGOING_EVENT or Notification.FLAG_FOREGROUND_SERVICE) != 0,
      groupSummary = n.flags and Notification.FLAG_GROUP_SUMMARY != 0,
      title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
      text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
      bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString(),
      subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString(),
      conversationTitle = extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString(),
      isGroupConversation = extras.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION),
      messages = messages,
      textLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.map { it.toString() }.orEmpty(),
    )
  }
}
