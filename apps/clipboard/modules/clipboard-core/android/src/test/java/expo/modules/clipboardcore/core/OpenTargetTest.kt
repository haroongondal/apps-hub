package expo.modules.clipboardcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OpenTargetTest {
  @Test fun `web links open in the browser`() {
    assertEquals(OpenTarget.BROWSE, OpenTarget.action("https://example.com/a?b=c#d"))
    assertEquals(OpenTarget.BROWSE, OpenTarget.action("http://example.com"))
    assertEquals(OpenTarget.BROWSE, OpenTarget.action("https://www.ups.com/track?tracknum=1Z999AA10123456784"))
  }

  @Test fun `phone numbers only open the dialer`() {
    assertEquals(OpenTarget.DIAL, OpenTarget.action("tel:+923001234567"))
    assertEquals(OpenTarget.DIAL, OpenTarget.action("tel:03001234567"))
    assertNull(OpenTarget.action("tel:*21*123#"))
    assertNull(OpenTarget.action("tel:0300;ext=1"))
  }

  @Test fun `map queries must be percent-encoded`() {
    assertEquals(OpenTarget.VIEW, OpenTarget.action("geo:0,0?q=221B%20Baker%20Street%2C%20London"))
    assertNull(OpenTarget.action("geo:0,0?q=221B Baker Street"))
    assertNull(OpenTarget.action("geo:0,0?q=a&z=3"))
  }

  @Test fun `every other scheme or a malformed uri is refused`() {
    listOf(
      "javascript:alert(1)", "intent://scan/#Intent;scheme=zxing;end", "file:///sdcard/x", "content://x/y",
      "market://details?id=x", "sms:0300", "HTTPS://example.com", "https://exa mple.com", "https://example.com/\n",
      "https://user@example.com", "https:///path", "", "geo:31.5,74.3",
    ).forEach { assertNull(it, OpenTarget.action(it)) }
  }
}
