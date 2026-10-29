package expo.modules.deputyagent.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ObservationBuilderTest {
  private val self = "com.haroon.deputy"
  private val policy = Policy(trust = { if (it == "com.vault") TrustLevel.BLOCKED else TrustLevel.STANDARD }, allowedApps = null, self = self)
  private val viewport = Bounds(0, 0, 1000, 2000)

  private fun node(text: String? = null, y: Int = 1000, pkg: String = "com.chat", password: Boolean = false, editable: Boolean = false) =
    NodeRef(pkg, text, null, null, null, Bounds(0, y - 10, 1000, y + 10), editable = editable, password = password)

  private fun screen(vararg nodes: NodeRef, pkg: String = "com.chat", title: String? = "Ali", keyboardUp: Boolean = false) =
    Screen(pkg, app = "Chat", title = title, keyboardUp = keyboardUp, viewport = viewport, nodes = nodes.toList())

  private fun build(screen: Screen, maxNodes: Int = 150, maxChars: Int = 8_000) =
    ObservationBuilder(policy, selfLabel = "Deputy", maxNodes = maxNodes, maxChars = maxChars).build(screen.pkg) { screen }

  @Test fun aBlockedOrOwnAppInFrontIsNeverRead() {
    val b = ObservationBuilder(policy, selfLabel = "Deputy")
    assertNull(b.build("com.vault") { error("the tree was read") })
    assertNull(b.build(self) { error("the tree was read") })
  }

  @Test fun theNotificationShadeIsNeverReadBecauseItsRowsCantBeTiedToApps() {
    val ui = "com.android.systemui"
    val obs = build(screen(node("Vault code 123456", pkg = ui), pkg = ui, title = null))!!
    assertFalse(obs.text.contains("123456"))
    assertTrue(obs.text.contains("not read"))
    assertTrue(obs.nodes.isEmpty() && obs.all.isEmpty())
  }

  @Test fun noScreenshotWhileDeputyOrABlockedAppsUnreadWindowIsOnScreen() {
    assertFalse(build(screen(node("Hi"), node("Deputy's step log", pkg = self)))!!.screenshotSafe)
    assertFalse(build(screen(node("Hi")).copy(unread = listOf(Area("com.vault", viewport))))!!.screenshotSafe)
    assertTrue(build(screen(node("Hi")).copy(unread = listOf(Area("com.android.systemui", viewport))))!!.screenshotSafe)
  }

  @Test fun unreadWindowsReachThePolicy() {
    val keyboard = Bounds(0, 1500, 1000, 2000)
    assertEquals(listOf(keyboard), build(screen(node("Hi")).copy(unread = listOf(Area("com.keyboard", keyboard))))!!.context.unread)
  }

  @Test fun anAppThatTurnsOutBlockedWhileReadingYieldsNothing() =
    assertNull(ObservationBuilder(policy, selfLabel = "Deputy").build("com.chat") { screen(node("code 123456"), pkg = "com.vault") })

  @Test fun formatsTheHeaderAndKeepsRawIndicesInTheMap() {
    val obs = build(screen(node(), node("Hello"), node("Type a message", editable = true), keyboardUp = true))!!
    assertEquals(
      "<screen app=\"Chat\" pkg=\"com.chat\" title=\"Ali\" keyboard=\"up\" nodes=\"2\" dropped=\"0\">\n" +
        "[1] text \"Hello\"\n[2] editable \"Type a message\"\n</screen>",
      obs.text,
    )
    assertEquals(setOf(1, 2), obs.nodes.keys)
    assertEquals("Hello", obs.nodes[1]?.text)
    assertEquals(ScreenContext("com.chat", "Ali", showsSelf = false), obs.context)
  }

  @Test fun passwordTextLeavesNeitherTheTextNorTheIndexMap() {
    val obs = build(screen(node("hunter2", password = true, editable = true)))!!
    assertFalse(obs.text, obs.text.contains("hunter2"))
    assertTrue(obs.text, obs.text.contains("[0] password"))
    assertNull(obs.nodes[0]?.text)
  }

  @Test fun dropsNodesFromBlockedAndDeputyWindowsSuchAsTheStopChip() {
    val obs = build(screen(node("Stop", pkg = self), node("123456", pkg = "com.vault"), node("Hi")))!!
    assertEquals(setOf(2), obs.nodes.keys)
    assertFalse(obs.text, obs.text.contains("Stop") || obs.text.contains("123456"))
  }

  @Test fun overTheNodeCapKeepsTheNodesNearestTheCentreInReadingOrder() {
    val obs = build(screen(node("top", y = 10), node("mid-high", y = 900), node("mid-low", y = 1100), node("bottom", y = 1990)), maxNodes = 2)!!
    assertEquals(setOf(1, 2), obs.nodes.keys)
    assertTrue(obs.text, obs.text.contains("nodes=\"2\" dropped=\"2\""))
    assertTrue(obs.text, obs.text.indexOf("mid-high") < obs.text.indexOf("mid-low"))
  }

  @Test fun overTheTextBudgetDropsTheFarthestNodes() {
    val obs = build(screen(node("a".repeat(40), y = 1000), node("b".repeat(40), y = 10)), maxChars = 60)!!
    assertEquals(setOf(0), obs.nodes.keys)
    assertTrue(obs.text, obs.text.contains("dropped=\"1\""))
  }

  private fun row(text: String? = null, depth: Int, clickable: Boolean = false, password: Boolean = false) =
    NodeRef("com.android.settings", text, null, null, null, Bounds(0, 990, 1000, 1010), clickable = clickable, password = password, depth = depth)

  @Test fun liftsChildLabelsOntoAnUnlabelledClickableRow() {
    val obs = build(screen(row(depth = 1, clickable = true), row("About phone", 2), row("Android 16", 2), row(depth = 1, clickable = true), row("Battery", 2), pkg = "com.android.settings"))!!
    assertTrue(obs.text, obs.text.contains("\n[0] text \"About phone, Android 16\" clickable\n[3] text \"Battery\" clickable\n</screen>"))
    assertEquals(setOf(0, 3), obs.nodes.keys)
    assertEquals("About phone, Android 16", obs.nodes[0]?.label)
    assertNull("the node's own text stays as the platform gave it", obs.nodes[0]?.text)
  }

  @Test fun doesNotLiftFromNestedClickablesOrPasswordFields() {
    val obs = build(
      screen(row(depth = 1, clickable = true), row("Wi-Fi", 2), row(depth = 2, clickable = true), row("On", 3), row("hunter2", 2, password = true), pkg = "com.android.settings"),
    )!!
    assertEquals("Wi-Fi", obs.nodes[0]?.label)
    assertEquals("On", obs.nodes[2]?.label)
    assertFalse(obs.text, obs.text.contains("hunter2"))
  }

  @Test fun aVeryLongNodeIsShortenedNotDropped() {
    val obs = build(screen(node("x".repeat(9_000))))!!
    assertTrue(obs.text, obs.text.contains("nodes=\"1\" dropped=\"0\""))
    assertTrue(obs.text.contains("…"))
  }

  @Test fun countsLabelledNodesForTheScreenshotRule() =
    assertEquals(2, build(screen(node("a"), node("b"), node(null, editable = true)))!!.labelled)

  @Test fun noticesDeputysNameOnScreen() =
    assertTrue(build(screen(node("Use Deputy"), pkg = "com.android.settings"))!!.context.showsSelf)

  @Test fun titleCannotCloseTheHeader() =
    assertTrue(build(screen(title = "a\"><screen"))!!.text.startsWith("<screen app=\"Chat\" pkg=\"com.chat\" title=\"a\\\">&lt;screen\" keyboard="))
}
