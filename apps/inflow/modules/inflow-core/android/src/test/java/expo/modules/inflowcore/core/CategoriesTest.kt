package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CategoriesTest {
  @Test fun listsAreExact() {
    assertEquals(
      listOf(
        "Food & dining", "Groceries", "Shopping", "Mobile & internet", "Bills & utilities", "Rent", "Transport", "Fuel", "Health",
        "Education", "Entertainment", "Travel", "Family", "Charity", "Sent to people", "Fees & charges", "Cash withdrawal", "Other",
      ),
      Categories.OUT,
    )
    assertEquals(18, Categories.OUT.size)
    assertEquals(listOf("Salary", "Received from people", "Refund", "Other income"), Categories.IN)
    assertEquals(Categories.OUT, Categories.forDirection(Direction.OUT))
    assertEquals(Categories.IN, Categories.forDirection(Direction.IN))
  }

  @Test fun fallbackPerDirection() {
    assertEquals("Other", Categories.fallback(Direction.OUT))
    assertEquals("Other income", Categories.fallback(Direction.IN))
  }

  @Test fun migratesOldValues() {
    assertEquals("Food & dining", Categories.migrate("Food", Direction.OUT))
    assertEquals("Bills & utilities", Categories.migrate("Bills", Direction.OUT))
    assertEquals("Fees & charges", Categories.migrate("Fees", Direction.OUT))
    assertEquals("Groceries", Categories.migrate("Groceries", Direction.OUT))
    assertNull(Categories.migrate("Food", Direction.IN))
    assertEquals("Salary", Categories.migrate("Salary", Direction.IN))
    assertNull(Categories.migrate(null, Direction.OUT))
  }
}
