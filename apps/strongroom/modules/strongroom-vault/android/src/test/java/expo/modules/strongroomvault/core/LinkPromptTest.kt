package expo.modules.strongroomvault.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LinkPromptTest {
  private val certA = "a".repeat(64)
  private val certB = "b".repeat(64)
  private val login = Entry.Login("Bank", "me", "pw", listOf(Site(true, "bank.com")), listOf(AppLink(AppId("com.bank", certA), null)), "", 1)

  @Test fun linkRefusedForSamePackageOtherCert() {
    val p = LinkPrompt.build(login, Requester.App(AppId("com.bank", certB), null), false)
    assertEquals("This app has the same name as the saved one but a different signature. It may be fake. Strongroom won't fill it.", p.refusal)
    assertEquals("com.bank", p.pkg)
  }

  @Test fun onlyKnownStoresCountAsNotFromAFile() {
    for (store in listOf("com.android.vending", "com.haroon.store", "org.fdroid.fdroid", "com.xiaomi.mipicks", "com.xiaomi.market")) {
      assertFalse(store, LinkPrompt.installedFromFile(store))
    }
    for (other in listOf(null, "", "com.miui.packageinstaller", "com.google.android.packageinstaller", "com.android.shell", "com.android.vending.evil")) {
      assertTrue(other.toString(), LinkPrompt.installedFromFile(other))
    }
  }

  @Test fun sameCertOrOtherPackageIsNotRefused() {
    assertNull(LinkPrompt.build(login, Requester.App(AppId("com.bank", certA), "bank.com"), false).refusal)
    assertNull(LinkPrompt.build(login, Requester.App(AppId("com.other", certB), null), false).refusal)
    assertNull(LinkPrompt.build(login, Requester.Web(Site(true, "bank.com")), false).refusal)
  }

  @Test fun promptShowsPackageAndSideloadFlag() {
    val app = LinkPrompt.build(login, Requester.App(AppId("com.x", certA), null), true)
    assertEquals("com.x", app.pkg)
    assertNull(app.domain)
    assertTrue(app.installedFromFile)
    assertNull(app.refusal)
    assertEquals("bank.com", LinkPrompt.build(login, Requester.App(AppId("com.x", certA), "bank.com"), false).domain)
    val web = LinkPrompt.build(login, Requester.Web(Site(true, "login.example.com")), false)
    assertEquals("example.com", web.domain)
    assertNull(web.pkg)
    assertFalse(web.installedFromFile)
  }

  @Test fun httpPageOfAnHttpsLoginIsRefused() {
    val insecure = "This page isn't secure (http). Strongroom won't fill a login saved for the secure site."
    for (host in listOf("bank.com", "www.bank.com", "bank.com:8080")) {
      assertEquals(host, insecure, LinkPrompt.build(login, Requester.Web(Site(false, host)), false).refusal)
    }
    val router = login.copy(sites = listOf(Site(true, "192.168.1.1")))
    assertEquals(insecure, LinkPrompt.build(router, Requester.Web(Site(false, "192.168.1.1")), false).refusal)
    assertNull(LinkPrompt.build(login, Requester.Web(Site(false, "other.com")), false).refusal)
    assertNull(LinkPrompt.build(router, Requester.Web(Site(false, "192.168.1.2")), false).refusal)
  }

  @Test fun siteWithoutRegistrableDomainShowsTheHost() {
    assertEquals("192.168.1.1:8080", LinkPrompt.build(login, Requester.Web(Site(false, "192.168.1.1:8080")), false).domain)
  }
}
