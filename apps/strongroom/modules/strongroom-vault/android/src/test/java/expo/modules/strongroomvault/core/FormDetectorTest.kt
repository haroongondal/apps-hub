package expo.modules.strongroomvault.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FormDetectorTest {
  // android.text.InputType values, copied so the test needs no Android classes.
  private val text = 1
  private val textPassword = 1 or 128
  private val textWebPassword = 1 or 224
  private val textVisiblePassword = 1 or 144
  private val textEmail = 1 or 32
  private val textWebEmail = 1 or 208
  private val textUri = 1 or 16
  private val numberPassword = 2 or 16

  private fun node(
    index: Int,
    hints: List<String> = emptyList(),
    inputType: Int = text,
    htmlType: String? = null,
    htmlAutocomplete: String? = null,
    htmlName: String? = null,
    idEntry: String? = null,
    hintText: String? = null,
    webDomain: String? = null,
  ) = FieldNode(index, hints, inputType, htmlType, htmlAutocomplete, htmlName, idEntry, hintText, webDomain)

  private fun form(username: Int? = null, password: Int? = null, newPassword: Int? = null, card: CardFields? = null) =
    DetectedForm(username, password, newPassword, card)

  private fun card(number: Int? = null, holder: Int? = null, expMonth: Int? = null, expYear: Int? = null, expDate: Int? = null, cvc: Int? = null) =
    CardFields(number, holder, expMonth, expYear, expDate, cvc)

  @Test fun hintsWin() {
    val nodes = listOf(node(0, hints = listOf("username")), node(1, hints = listOf("password")))
    assertEquals(form(username = 0, password = 1), FormDetector.detect(nodes))
  }

  @Test fun hintsCompareCaseInsensitivelyAndOutrankInputType() {
    val nodes = listOf(node(0, hints = listOf("EmailAddress"), inputType = text), node(1, hints = listOf("PASSWORD"), inputType = text))
    assertEquals(form(username = 0, password = 1), FormDetector.detect(nodes))
    assertEquals(form(newPassword = 0), FormDetector.detect(listOf(node(0, hints = listOf("newPassword"), inputType = textPassword))))
  }

  @Test fun newUsernameHintIsAUsername() {
    val nodes = listOf(node(0, hints = listOf("newUsername")), node(1, hints = listOf("newPassword")))
    assertEquals(form(username = 0, newPassword = 1), FormDetector.detect(nodes))
  }

  @Test fun htmlAutocompleteNewPassword() {
    val nodes = listOf(
      node(0, htmlType = "email", htmlAutocomplete = "email"),
      node(1, htmlType = "password", htmlAutocomplete = "new-password"),
    )
    assertEquals(form(username = 0, newPassword = 1), FormDetector.detect(nodes))
  }

  @Test fun htmlAutocompleteMatchesAnyToken() {
    val nodes = listOf(
      node(0, htmlAutocomplete = "section-login username"),
      node(1, htmlType = "password", htmlAutocomplete = "section-login current-password"),
    )
    assertEquals(form(username = 0, password = 1), FormDetector.detect(nodes))
  }

  @Test fun currentAndNewPasswordAreBothSet() {
    val nodes = listOf(
      node(0, htmlAutocomplete = "username"),
      node(1, htmlAutocomplete = "current-password"),
      node(2, htmlAutocomplete = "new-password"),
    )
    assertEquals(form(username = 0, password = 1, newPassword = 2), FormDetector.detect(nodes))
  }

  @Test fun htmlTypePasswordIsAPasswordField() {
    assertEquals(form(password = 0), FormDetector.detect(listOf(node(0, htmlType = "password"))))
  }

  @Test fun inputTypeOnlyLoginForm() {
    val nodes = listOf(node(0, inputType = textEmail), node(1, inputType = textPassword))
    assertEquals(form(username = 0, password = 1), FormDetector.detect(nodes))
  }

  @Test fun everyPasswordVariationCounts() {
    for (t in listOf(textPassword, textWebPassword, textVisiblePassword, numberPassword)) {
      assertEquals("type $t", form(password = 0), FormDetector.detect(listOf(node(0, inputType = t))))
    }
    for (t in listOf(textEmail, textWebEmail)) {
      assertEquals("type $t", form(username = 1, password = 2), FormDetector.detect(listOf(node(0), node(1, inputType = t), node(2, inputType = textPassword))))
    }
  }

  @Test fun variationBitsOnlyMeanPasswordInTheirOwnClass() {
    // 16 is TYPE_NUMBER_VARIATION_PASSWORD in the number class but TYPE_TEXT_VARIATION_URI in the text class.
    assertEquals(form(), FormDetector.detect(listOf(node(0, inputType = textUri))))
  }

  @Test fun usernameIsFieldBeforePassword() {
    val nodes = listOf(
      node(0, hintText = "Search"),
      node(1, inputType = textEmail),
      node(2, inputType = textPassword),
    )
    assertEquals(form(username = 1, password = 2), FormDetector.detect(nodes))
  }

  @Test fun usernameIsTheNearestCandidateNotTheFirst() {
    val nodes = listOf(node(0, inputType = textEmail), node(1, inputType = textEmail), node(2, inputType = textPassword))
    assertEquals(form(username = 1, password = 2), FormDetector.detect(nodes))
  }

  @Test fun searchBoxNamedLikeAUserFieldDoesNotWin() {
    val nodes = listOf(node(0, idEntry = "search_users"), node(1, idEntry = "login_name"), node(2, inputType = textPassword))
    assertEquals(form(username = 1, password = 2), FormDetector.detect(nodes))
    assertEquals(form(password = 1), FormDetector.detect(listOf(node(0, idEntry = "search_users"), node(1, inputType = textPassword))))
  }

  @Test fun keywordsPickTheUsernameAndLoseToStrongerSignals() {
    assertEquals(form(username = 1, password = 2), FormDetector.detect(listOf(node(0), node(1, htmlName = "userId"), node(2, inputType = textPassword))))
    assertEquals(form(username = 0, password = 2), FormDetector.detect(listOf(node(0, inputType = textEmail), node(1, idEntry = "login_code"), node(2, inputType = textPassword))))
  }

  @Test fun usernameFallsBackToTheNearestPlainTextField() {
    val nodes = listOf(node(0), node(1), node(2, inputType = textPassword))
    assertEquals(form(username = 1, password = 2), FormDetector.detect(nodes))
  }

  @Test fun nonTextFieldsAreNeverTheUsernameFallback() {
    assertEquals(form(password = 1), FormDetector.detect(listOf(node(0, inputType = 4), node(1, inputType = textPassword))))
    assertEquals(form(password = 1), FormDetector.detect(listOf(node(0, inputType = textUri), node(1, inputType = textPassword))))
  }

  @Test fun usernameAfterThePasswordIsIgnored() {
    val nodes = listOf(node(0, inputType = textPassword), node(1, inputType = textEmail))
    assertEquals(form(password = 0), FormDetector.detect(nodes))
  }

  @Test fun passwordKeywordNeedsNoPasswordInputType() {
    assertEquals(form(username = 0, password = 1), FormDetector.detect(listOf(node(0, idEntry = "email"), node(1, hintText = "Password"))))
    assertEquals(form(), FormDetector.detect(listOf(node(0, idEntry = "passport_number"))))
  }

  @Test fun theFirstPasswordFieldIsTheTarget() {
    val nodes = listOf(node(0, inputType = textEmail), node(1, inputType = textPassword), node(2, inputType = textPassword))
    assertEquals(form(username = 0, password = 1), FormDetector.detect(nodes))
  }

  @Test fun nodesAreReadInIndexOrder() {
    val nodes = listOf(node(2, inputType = textPassword), node(1, inputType = textEmail), node(0, hintText = "Search"))
    assertEquals(form(username = 1, password = 2), FormDetector.detect(nodes))
  }

  @Test fun aLoneUsernameHintStillFillsButALoneEmailBoxDoesNot() {
    assertEquals(form(username = 0), FormDetector.detect(listOf(node(0, hints = listOf("username")))))
    assertEquals(form(username = 0), FormDetector.detect(listOf(node(0, htmlAutocomplete = "username"))))
    assertEquals(form(), FormDetector.detect(listOf(node(0, inputType = textEmail), node(1, idEntry = "email"))))
  }

  @Test fun cardFieldsFromAutocomplete() {
    val nodes = listOf(
      node(0, htmlAutocomplete = "cc-name"),
      node(1, htmlAutocomplete = "cc-number"),
      node(2, htmlAutocomplete = "cc-exp-month"),
      node(3, htmlAutocomplete = "cc-exp-year"),
      node(4, htmlAutocomplete = "cc-csc"),
    )
    assertEquals(form(card = card(number = 1, holder = 0, expMonth = 2, expYear = 3, cvc = 4)), FormDetector.detect(nodes))
    assertEquals(form(card = card(number = 0, expDate = 1)), FormDetector.detect(listOf(node(0, htmlAutocomplete = "cc-number"), node(1, htmlAutocomplete = "cc-exp"))))
  }

  @Test fun cardFieldsFromHints() {
    val nodes = listOf(
      node(0, hints = listOf("personName")),
      node(1, hints = listOf("creditCardNumber")),
      node(2, hints = listOf("creditCardExpirationDate")),
      node(3, hints = listOf("creditCardExpirationMonth")),
      node(4, hints = listOf("creditCardExpirationYear")),
      node(5, hints = listOf("creditCardSecurityCode")),
    )
    assertEquals(form(card = card(number = 1, holder = 0, expMonth = 3, expYear = 4, expDate = 2, cvc = 5)), FormDetector.detect(nodes))
  }

  @Test fun aLoneHolderNameIsNotACardForm() {
    assertEquals(form(), FormDetector.detect(listOf(node(0, hints = listOf("personName")))))
    assertEquals(form(), FormDetector.detect(listOf(node(0, htmlAutocomplete = "cc-name"))))
    assertEquals(form(card = card(holder = 0, cvc = 1)), FormDetector.detect(listOf(node(0, htmlAutocomplete = "cc-name"), node(1, htmlAutocomplete = "cc-csc"))))
  }

  @Test fun aLoginAndACardCanShareAPage() {
    val nodes = listOf(node(0, hints = listOf("username")), node(1, hints = listOf("password")), node(2, hints = listOf("creditCardNumber")))
    assertEquals(form(username = 0, password = 1, card = card(number = 2)), FormDetector.detect(nodes))
  }

  @Test fun noPasswordNoCardIsEmptyForm() {
    assertEquals(form(), FormDetector.detect(listOf(node(0, hintText = "Search"))))
    assertEquals(form(), FormDetector.detect(emptyList()))
    assertNull(FormDetector.detect(listOf(node(0, hintText = "Search"))).card)
  }

  @Test fun crossOriginFrameGetsNoFill() {
    val nodes = listOf(node(0, webDomain = "bank.com"), node(1, webDomain = "ads.example"))
    val f = form(username = 0, password = 1)
    assertFalse(FormDetector.allTargetsInDomain(nodes, f, "bank.com"))
    val same = listOf(node(0, webDomain = "Bank.com."), node(1, webDomain = "Bank.com."))
    assertTrue(FormDetector.allTargetsInDomain(same, f, "bank.com"))
    assertFalse(FormDetector.allTargetsInDomain(listOf(node(0, webDomain = "bank.com"), node(1, webDomain = null)), f, "bank.com"))
  }

  @Test fun everyFilledFieldMustReportTheDomain() {
    val nodes = listOf(
      node(0, webDomain = "bank.com"),
      node(1, webDomain = "bank.com"),
      node(2, webDomain = "bank.com"),
      node(3, webDomain = "bank.com"),
      node(4, webDomain = "evil.example"),
      node(5, webDomain = "elsewhere.example"),
    )
    val f = form(username = 0, password = 1, newPassword = 2, card = card(number = 3, cvc = 4))
    assertFalse(FormDetector.allTargetsInDomain(nodes, f, "bank.com"))
    assertTrue(FormDetector.allTargetsInDomain(nodes, form(username = 0, password = 1, newPassword = 2, card = card(number = 3)), "bank.com"))
    assertTrue(FormDetector.allTargetsInDomain(nodes, form(username = 0, password = 1), "bank.com"))
  }

  @Test fun anEmptyFormOrAnUnreadableHostIsNeverInDomain() {
    val nodes = listOf(node(0, webDomain = "bank.com"))
    assertFalse(FormDetector.allTargetsInDomain(nodes, form(), "bank.com"))
    assertFalse(FormDetector.allTargetsInDomain(nodes, form(password = 0), "not a host"))
    assertFalse(FormDetector.allTargetsInDomain(nodes, form(password = 7), "bank.com"))
    assertFalse(FormDetector.allTargetsInDomain(listOf(node(0, webDomain = "not a host")), form(password = 0), "bank.com"))
  }
}
