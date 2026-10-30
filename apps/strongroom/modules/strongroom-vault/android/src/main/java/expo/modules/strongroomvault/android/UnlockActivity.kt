package expo.modules.strongroomvault.android

import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.SpannableStringBuilder
import android.text.TextWatcher
import android.text.style.StyleSpan
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.AppCompatButton
import androidx.appcompat.widget.AppCompatEditText
import androidx.appcompat.widget.AppCompatTextView
import expo.modules.kotlin.exception.CodedException
import expo.modules.strongroomvault.coded
import expo.modules.strongroomvault.core.AuthRequest
import expo.modules.strongroomvault.core.Entry
import expo.modules.strongroomvault.core.LinkPrompt
import expo.modules.strongroomvault.core.Matching
import expo.modules.strongroomvault.core.Requester
import expo.modules.strongroomvault.core.Row
import expo.modules.strongroomvault.core.Saves
import expo.modules.strongroomvault.core.Vault
import expo.modules.strongroomvault.derive
import kotlin.concurrent.thread
import org.json.JSONException
import org.json.JSONObject

/** The autofill authentication screen. It trusts only Strongroom's own extras, never the structure or client state Android attaches. */
class UnlockActivity : AppCompatActivity() {
  private lateinit var req: AuthRequest
  private lateinit var targets: Map<String, AutofillId>
  private lateinit var root: LinearLayout
  private val colors by lazy { palette() }

  override fun onCreate(savedInstanceState: Bundle?) {
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    window.setHideOverlayWindows(true)
    super.onCreate(savedInstanceState)
    req = AuthRequest.parse { intent.getStringExtra(it) } ?: return finish()
    targets = Datasets.targets(intent)
    root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      colors["bg"]?.let(::setBackgroundColor)
      setOnApplyWindowInsetsListener { v, insets ->
        val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
        v.setPadding(bars.left + dp(24), bars.top + dp(24), bars.right + dp(24), bars.bottom + dp(24))
        insets
      }
    }
    setContentView(root)
    findViewById<View>(android.R.id.content).importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
    if (Build.VERSION.SDK_INT >= 34) window.decorView.setAccessibilityDataSensitive(View.ACCESSIBILITY_DATA_SENSITIVE_YES)
    start()
  }

  private fun vault(): Vault = VaultHolder.get(this).also { VaultHolder.touch() }

  private fun start() {
    screen(UNLOCK_TITLE, req.label)
    work({
      val v = vault()
      when {
        !v.isSetUp -> Step.NOT_SET_UP
        // A card fill authenticates even when the vault is open, so every card fill asks for the fingerprint.
        !v.isUnlocked || req.mode == "cards" || req.entryId?.let(v::get) is Entry.Card -> Step.AUTHENTICATE
        else -> Step.READY
      }
    }) { step ->
      when (step) {
        Step.NOT_SET_UP -> message(NOT_SET_UP)
        Step.AUTHENTICATE -> if (VaultHolder.biometricAllowed(this)) VaultHolder.biometricUnlock(this) { ok -> if (ok) unlocked() else passwordForm(null) } else passwordForm(null)
        Step.READY -> unlocked()
      }
    }
  }

  private fun passwordForm(error: String?) {
    screen(UNLOCK_TITLE, req.label)
    error?.let { body(it, colors["danger"]) }
    val field = AppCompatEditText(this).apply {
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
      imeOptions = EditorInfo.IME_ACTION_DONE or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
      importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
      hint = "Master password"
      colors["text"]?.let(::setTextColor)
    }
    root.addView(field, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    lateinit var unlock: AppCompatButton
    unlock = button("Unlock", primary = true) { submit(field, unlock) }
    field.setOnEditorActionListener { _, action, _ -> (action == EditorInfo.IME_ACTION_DONE).also { if (it && unlock.isEnabled) submit(field, unlock) } }
    button("Cancel") { finish() }
    field.requestFocus()
    field.post { getSystemService(InputMethodManager::class.java)?.showSoftInput(field, 0) }
  }

  private fun submit(field: AppCompatEditText, unlock: AppCompatButton) {
    val text = field.text ?: return
    val password = CharArray(text.length).also { text.getChars(0, text.length, it, 0) }
    text.clear()
    unlock.isEnabled = false
    unlock.text = "Unlocking…"
    work({
      try {
        derive { VaultHolder.passwordUnlock(this, password) }
      } finally {
        password.fill('\u0000')
      }
    }) { ok -> if (ok) unlocked() else passwordForm(WRONG_PASSWORD) }
  }

  private fun unlocked() {
    when (req.mode) {
      "fill" -> work({
        val e = vault().get(req.entryId!!)
        e to (e !is Entry.Login || Matching.matches(e, req.requester))
      }) { (e, matches) ->
        when {
          e == null -> message(GONE)
          !matches -> message(NO_MATCH)
          else -> fill(e)
        }
      }
      "pick" -> work({ vault().rows().filter { it.type == "login" } }) { list("Pick a login", "Strongroom has no logins yet.", it) }
      "cards" -> work({ vault().rows().filter { it.type == "card" } }) { list("Pick a card", "Strongroom has no cards yet.", it) }
    }
  }

  private fun list(title: String, empty: String, rows: List<Row>) {
    screen(title, null)
    if (rows.isEmpty()) return message(empty)
    val adapter = object : ArrayAdapter<Row>(this, android.R.layout.simple_list_item_2, android.R.id.text1, rows.toMutableList()) {
      override fun getView(position: Int, convertView: View?, parent: ViewGroup): View = super.getView(position, convertView, parent).apply {
        val row = getItem(position)!!
        findViewById<TextView>(android.R.id.text1).apply { text = row.name; colors["text"]?.let(::setTextColor) }
        findViewById<TextView>(android.R.id.text2).apply { text = row.subtitle; colors["muted"]?.let(::setTextColor) }
      }
    }
    val search = AppCompatEditText(this).apply {
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
      imeOptions = EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
      importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
      hint = "Search"
      colors["text"]?.let(::setTextColor)
      addTextChangedListener(object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit

        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit

        override fun afterTextChanged(s: Editable?) {
          val q = s?.toString()?.trim().orEmpty()
          adapter.clear()
          adapter.addAll(rows.filter { it.name.contains(q, ignoreCase = true) || it.subtitle.contains(q, ignoreCase = true) })
        }
      })
    }
    root.addView(search, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    val listView = ListView(this).apply {
      this.adapter = adapter
      filterTouchesWhenObscured = true
      setOnItemClickListener { _, _, position, _ -> adapter.getItem(position)?.let(::pick) }
    }
    root.addView(listView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    button("Cancel") { finish() }
  }

  private fun pick(row: Row) {
    work({
      val e = vault().get(row.id)
      val prompt = (e as? Entry.Login)?.takeIf { !Matching.matches(it, req.requester) }?.let { LinkPrompt.build(it, req.requester, installedFromFile()) }
      e to prompt
    }) { (e, prompt) ->
      when {
        e == null -> message(GONE)
        prompt != null -> linkPrompt(row.id, e as Entry.Login, prompt)
        else -> fill(e)
      }
    }
  }

  private fun linkPrompt(id: String, login: Entry.Login, prompt: LinkPrompt) {
    screen(login.name, null)
    if (prompt.refusal != null) {
      body(prompt.refusal, colors["danger"])
      button("Cancel") { finish() }
      return
    }
    val text = SpannableStringBuilder("This login isn't saved for ")
    bold(text, prompt.pkg ?: prompt.domain.orEmpty())
    if (prompt.pkg != null && prompt.domain != null) bold(text.append(" on "), prompt.domain)
    body(text.append('.'), colors["text"])
    if (prompt.installedFromFile) body("This app was installed from a file, not from an app store.", colors["danger"])
    button("Fill once", primary = true) { fill(login) }.filterTouchesWhenObscured = true
    button("Always use here") {
      work({
        val linked = Saves.link(login, req.requester)
        vault().put(id, linked)
        VaultHolder.refreshIndex(this)
        linked
      }) { fill(it) }
    }.filterTouchesWhenObscured = true
    button("Cancel") { finish() }
  }

  private fun fill(e: Entry) {
    val dataset = Datasets.filled(targets, e) ?: return message(NOTHING_TO_FILL)
    setResult(RESULT_OK, Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset))
    finish()
  }

  private fun message(text: String) {
    body(text, colors["text"])
    button("Cancel") { finish() }
  }

  private fun installedFromFile(): Boolean {
    val pkg = (req.requester as? Requester.App)?.id?.pkg ?: return false
    return try {
      packageManager.getInstallSourceInfo(pkg).installingPackageName.let { it == null || it in FILE_INSTALLERS }
    } catch (e: PackageManager.NameNotFoundException) {
      true
    }
  }

  private fun <T> work(block: () -> T, then: (T) -> Unit) {
    thread(name = "strongroom-unlock-screen") {
      val result = try {
        Result.success(block())
      } catch (e: Exception) {
        Result.failure(e)
      }
      runOnUiThread {
        if (isFinishing || isDestroyed) return@runOnUiThread
        result.fold(then) { e ->
          val known = (e as? CodedException) ?: (e as? IllegalStateException)?.let(::coded) as? CodedException
          message(known?.message ?: FAILED)
        }
      }
    }
  }

  private fun screen(title: String, subtitle: String?) {
    root.removeAllViews()
    root.addView(AppCompatTextView(this).apply {
      text = title
      textSize = 22f
      setTypeface(typeface, Typeface.BOLD)
      colors["text"]?.let(::setTextColor)
    })
    subtitle?.takeIf { it.isNotEmpty() }?.let { body(it, colors["muted"]) }
  }

  private fun body(text: CharSequence, color: Int?) {
    root.addView(AppCompatTextView(this).apply {
      this.text = text
      textSize = 16f
      setPadding(0, dp(12), 0, 0)
      color?.let(::setTextColor)
    })
  }

  private fun button(label: String, primary: Boolean = false, onClick: () -> Unit): AppCompatButton {
    val b = if (primary) AppCompatButton(this) else AppCompatButton(this, null, androidx.appcompat.R.attr.borderlessButtonStyle)
    b.text = label
    b.isAllCaps = false
    if (primary) {
      colors["accent"]?.let { b.backgroundTintList = ColorStateList.valueOf(it) }
      colors["onAccent"]?.let(b::setTextColor)
    } else {
      colors["accent"]?.let(b::setTextColor)
    }
    b.setOnClickListener { onClick() }
    root.addView(b, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
    return b
  }

  private fun bold(text: SpannableStringBuilder, part: String) {
    val start = text.length
    text.append(part).setSpan(StyleSpan(Typeface.BOLD), start, text.length, 0)
  }

  private fun palette(): Map<String, Int> {
    val json = VaultHolder.prefs(this).getString(VaultHolder.PALETTE, null) ?: return emptyMap()
    return try {
      val scheme = JSONObject(json).optJSONObject(if (resources.configuration.isNightModeActive) "dark" else "light") ?: return emptyMap()
      PALETTE_KEYS.mapNotNull { k -> scheme.optString(k).takeIf(HEX::matches)?.let { k to Color.parseColor(it) } }.toMap()
    } catch (e: JSONException) {
      emptyMap()
    }
  }

  private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

  private enum class Step { NOT_SET_UP, AUTHENTICATE, READY }

  private companion object {
    const val UNLOCK_TITLE = "Unlock Strongroom"
    const val WRONG_PASSWORD = "That isn't the master password. Try again."
    const val NOT_SET_UP = "Strongroom isn't set up on this phone yet. Open Strongroom and set it up first."
    const val GONE = "That entry is no longer in Strongroom. Pick another one."
    const val NO_MATCH = "This login isn't saved for this app or site, so Strongroom won't fill it. Use Other logins instead."
    const val NOTHING_TO_FILL = "This entry has nothing to fill in these fields."
    const val FAILED = "Strongroom couldn't finish this fill. Try again."
    val PALETTE_KEYS = listOf("bg", "text", "muted", "accent", "onAccent", "danger")
    val HEX = Regex("#[0-9A-Fa-f]{6}")
    val FILE_INSTALLERS = setOf(
      "com.android.packageinstaller",
      "com.google.android.packageinstaller",
      "com.android.documentsui",
      "com.google.android.documentsui",
      "com.google.android.apps.nbu.files",
      "com.android.fileexplorer",
      "com.mi.android.globalFileexplorer",
    )
  }
}
