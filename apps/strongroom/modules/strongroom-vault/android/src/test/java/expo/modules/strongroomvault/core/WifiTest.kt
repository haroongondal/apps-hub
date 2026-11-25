package expo.modules.strongroomvault.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// The same cases are in apps/strongroom/src/__tests__/pass-forms.test.ts (editableWifi), so both sides open the same passes as Wi-Fi.
class WifiTest {
  private val qr = PassFormat.QR

  @Test fun aCodeTheFormWroteIsEditableAsWifi() {
    assertTrue(Wifi.editable("Home", Wifi.code("Home", "hunter2hunter2", true), qr))
    assertTrue(Wifi.editable("  Home  ", Wifi.code("Home", "pw", true), qr))
    assertTrue(Wifi.editable("Cafe", Wifi.code("Cafe", "", false), qr))
    val tricky = Wifi.code("Mum & Dad; \"5G\": ok", "a\\b;c,d:e\"f", true)
    assertEquals("""WIFI:T:WPA;S:Mum & Dad\; \"5G\"\: ok;P:a\\b\;c\,d\:e\"f;;""", tricky)
    assertTrue(Wifi.editable("Mum & Dad; \"5G\": ok", tricky, qr))
  }

  @Test fun anythingElseIsEditedAsAPlainPassSoItsCodeIsNeverRewritten() {
    val real = "WIFI:T:WPA;S:TP-Link_5G;P:s3cret;;"
    assertTrue(Wifi.editable("TP-Link_5G", real, qr))
    assertFalse("entry name differs from the network name", Wifi.editable("Home router", real, qr))
    for (code in listOf(
      "WIFI:T:WPA;S:Home;P:pw;H:true;;", "WIFI:T:WPA2-EAP;S:Home;E:PEAP;I:alice;P:pw;;", "WIFI:T:WEP;S:Home;P:pw;;", "WIFI:T:SAE;S:Home;P:pw;;",
      "WIFI:S:Home;P:pw;;", "WIFI:T:WPA;P:pw;;", "WIFI:T:WPA;S:Home;P:pw", "https://example.com", "",
    )) assertFalse(code, Wifi.editable("Home", code, qr))
    for (f in listOf(PassFormat.CODE128, PassFormat.EAN13)) assertFalse(Wifi.editable("TP-Link_5G", real, f))
  }

  @Test fun aWifiCodeIsNeverPresentedOverNfc() {
    assertFalse(Wifi.mayPresent("WIFI:T:WPA;S:Home;P:pw;;"))
    assertFalse(Wifi.mayPresent("wifi:T:WPA;S:Home;P:pw;;"))
    assertFalse(Wifi.mayPresent("WIFI:T:WEP;S:Home;P:pw;;")) // even one the form cannot edit
    assertTrue(Wifi.mayPresent("https://gym.example/m/42"))
    assertTrue(Wifi.mayPresent("1234567890128"))
  }
}
