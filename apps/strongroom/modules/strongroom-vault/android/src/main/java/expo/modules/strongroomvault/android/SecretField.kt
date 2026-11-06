package expo.modules.strongroomvault.android

import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.ViewStructure
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import androidx.appcompat.widget.AppCompatEditText
import com.facebook.react.common.assets.ReactFontManager
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.roundToInt

/** An EditText no autofill service sees: Android drops a view whose autofill type is NONE before any importance check or heuristic, and leaves it out of the assist structure. */
class SecretEditText(context: Context) : AppCompatEditText(context) {
  init {
    importantForAutofill = IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
    importantForContentCapture = IMPORTANT_FOR_CONTENT_CAPTURE_NO_EXCLUDE_DESCENDANTS
    // An EditText freezes its text into saved state; this field's text must never reach a Bundle.
    isSaveEnabled = false
  }

  override fun getAutofillType() = AUTOFILL_TYPE_NONE

  // A manual request, PCC or compat mode puts even this field in the assist structure, and the Save request carries its text unsanitised: write nothing.
  override fun onProvideAutofillStructure(structure: ViewStructure, flags: Int) = Unit

  // Content capture and the assistant read the same text through their own structure calls (content capture's text-change events are stopped by the importance flag above).
  override fun onProvideContentCaptureStructure(structure: ViewStructure, flags: Int) = Unit

  override fun onProvideStructure(structure: ViewStructure) = Unit

  override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? =
    super.onCreateInputConnection(outAttrs).also { outAttrs.imeOptions = outAttrs.imeOptions or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING }
}

internal fun secretInputType(shown: Boolean, numeric: Boolean, multiline: Boolean): Int =
  if (numeric) {
    InputType.TYPE_CLASS_NUMBER or (if (shown) 0 else InputType.TYPE_NUMBER_VARIATION_PASSWORD)
  } else {
    InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or
      (if (shown) InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD else InputType.TYPE_TEXT_VARIATION_PASSWORD) or
      (if (multiline) InputType.TYPE_TEXT_FLAG_MULTI_LINE else 0)
  }

/** JS's value is stale when it hasn't seen the latest keystroke (applying it would drop what was just typed); an equal value is a no-op. */
internal fun shouldApplyValue(jsEventCount: Int, eventCount: Int, current: CharSequence?, value: String): Boolean =
  jsEventCount >= eventCount && current?.contentEquals(value) != true

class SecretFieldView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onChangeValue by EventDispatcher()
  private val onSubmit by EventDispatcher()
  private val onFocusChange by EventDispatcher()
  private val onContentHeight by EventDispatcher()
  val input = SecretEditText(context)
  var value = ""
  var jsEventCount = 0
  var shown = false
  var numeric = false
  var multiline = false
  var fontFamily = ""
  var fontSize = 16f
  var textInset = 0f
  private var eventCount = 0
  private var quiet = false
  private var contentHeight = -1f

  override val shouldUseAndroidLayout = true

  init {
    input.background = null
    input.imeOptions = EditorInfo.IME_ACTION_DONE
    addView(input, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    input.addTextChangedListener(object : TextWatcher {
      override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit

      override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit

      override fun afterTextChanged(s: Editable?) {
        if (!quiet) onChangeValue(mapOf("text" to s.toString(), "eventCount" to ++eventCount))
        reportHeight()
      }
    })
    input.setOnFocusChangeListener { _, focused -> onFocusChange(mapOf("focused" to focused)) }
    input.setOnEditorActionListener { v, _, event ->
      if (multiline) return@setOnEditorActionListener false
      if (event == null || event.action == KeyEvent.ACTION_DOWN) {
        onSubmit(emptyMap())
        v.clearFocus()
        context.getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(v.windowToken, 0)
      }
      true
    }
  }

  fun setSelectionColor(color: Int) {
    input.highlightColor = color
    input.textCursorDrawable?.let { input.textCursorDrawable = it.tinted(color) }
    input.textSelectHandle?.let { input.setTextSelectHandle(it.tinted(color)) }
    input.textSelectHandleLeft?.let { input.setTextSelectHandleLeft(it.tinted(color)) }
    input.textSelectHandleRight?.let { input.setTextSelectHandleRight(it.tinted(color)) }
  }

  fun update() {
    val type = secretInputType(shown, numeric, multiline)
    if (input.inputType != type) {
      quietly {
        val start = input.selectionStart
        val end = input.selectionEnd
        input.inputType = type
        if (start >= 0) input.setSelection(start, end)
      }
    }
    input.gravity = (if (multiline) Gravity.TOP else Gravity.CENTER_VERTICAL) or Gravity.START
    val pad = (textInset * resources.displayMetrics.density).roundToInt()
    input.setPadding(pad, if (multiline) pad else 0, pad, if (multiline) pad else 0)
    if (fontFamily.isNotEmpty()) input.typeface = ReactFontManager.getInstance().getTypeface(fontFamily, Typeface.NORMAL, context.assets)
    input.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSize)
    if (shouldApplyValue(jsEventCount, eventCount, input.text, value)) {
      quietly {
        input.setText(value)
        input.setSelection(value.length)
      }
    }
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    reportHeight()
  }

  private fun reportHeight() {
    val text = input.layout ?: return
    val height = (text.height + input.compoundPaddingTop + input.compoundPaddingBottom) / resources.displayMetrics.density
    if (height == contentHeight) return
    contentHeight = height
    onContentHeight(mapOf("height" to height))
  }

  private inline fun quietly(block: () -> Unit) {
    quiet = true
    try {
      block()
    } finally {
      quiet = false
    }
  }

  private fun Drawable.tinted(color: Int) = mutate().apply { setTint(color) }
}
