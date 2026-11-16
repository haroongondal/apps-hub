package expo.modules.inflowcore.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ContactAppsTest {
  private val sms = setOf("com.google.android.apps.messaging")

  @Test fun smsGmailAndTeamsAreGroupedEvenWithoutChats() {
    assertTrue(ContactApps.byContact("com.google.android.apps.messaging", sms, hasChats = false))
    assertTrue(ContactApps.byContact("com.google.android.gm", sms, hasChats = false))
    assertTrue(ContactApps.byContact("com.microsoft.teams", sms, hasChats = false))
  }

  @Test fun anAppWithChatsIsGrouped() {
    assertTrue(ContactApps.byContact("com.whatsapp", sms, hasChats = true))
  }

  @Test fun anOrdinaryAppKeepsItsFlatList() {
    assertFalse(ContactApps.byContact("com.daraz.android", sms, hasChats = false))
  }
}
