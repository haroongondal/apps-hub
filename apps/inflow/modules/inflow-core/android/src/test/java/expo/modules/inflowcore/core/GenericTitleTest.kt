package expo.modules.inflowcore.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GenericTitleTest {
  @Test fun countAndBareNewMessageTitlesAreGeneric() {
    for (t in listOf("1 new message", "12 New Messages", " 3 new messages ", "new message")) assertTrue(t, GenericTitle.isGeneric(t))
  }

  @Test fun realNamesAreNot() {
    for (t in listOf(null, "", "Ammi", "2 new photos", "You")) assertFalse(t.toString(), GenericTitle.isGeneric(t))
  }
}
