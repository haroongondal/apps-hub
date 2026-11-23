package expo.modules.inflowcore.android

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputFilter
import android.text.InputType
import android.util.TypedValue
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.FragmentActivity
import expo.modules.inflowcore.applink.AppLinkActivityCaller
import expo.modules.inflowcore.core.AddTodo
import expo.modules.inflowcore.core.AddTodoFlow
import expo.modules.inflowcore.core.AddTodoParse
import expo.modules.inflowcore.core.AddTodoRequest
import expo.modules.inflowcore.core.Edits
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * com.haroon.inflow.action.ADD_TODO. Order of events: the caller must be a same-key app that used startActivityForResult, the extras must
 * validate, the owner passes the same fingerprint prompt as the app (Lock), and only then does the screen appear. A to-do is written only by
 * the owner's tap on Add (AddTodoFlow refuses before that). Text from the other app is shown as plain text and never logged.
 */
class AddTodoActivity : FragmentActivity() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
  private var flow: AddTodoFlow? = null
  private var started = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!AppLinkActivityCaller.allowed(this)) return end()
    val raw = rawExtras() ?: return end()
    val request = (AddTodo.parse(raw) as? AddTodoParse.Ok)?.request ?: return end()
    flow = AddTodoFlow(request) { text, dueAt ->
      StoreHolder.get(applicationContext).getOrThrow().addTodo(text, dueAt)
    }
    setResult(Activity.RESULT_CANCELED, result(AddTodo.STATUS_CANCELLED, AddTodo.CODE_CANCELLED))   // any way out but Add answers "cancelled"
  }

  // A bundle holding a class this app lacks throws when read; that counts as a refused start.
  @Suppress("DEPRECATION")
  private fun rawExtras(): Map<String, Any?>? = runCatching {
    val extras = intent?.extras
    extras?.keySet()?.associateWith { extras.get(it) } ?: emptyMap()
  }.getOrNull()

  // The fingerprint prompt needs a resumed activity, and the lifecycle reaches that just after onResume returns.
  override fun onResume() {
    super.onResume()
    if (started || flow == null) return
    started = true
    Handler(Looper.getMainLooper()).post { unlock() }
  }

  override fun onDestroy() {
    scope.cancel()
    super.onDestroy()
  }

  private fun unlock() {
    val flow = flow ?: return
    scope.launch {
      val (ok, message) = Lock.authenticate(this@AddTodoActivity)
      if (!ok) {
        if (message != null) Toast.makeText(this@AddTodoActivity, message, Toast.LENGTH_LONG).show()
        return@launch end()
      }
      flow.unlocked()
      show(flow)
    }
  }

  private fun show(flow: AddTodoFlow) {
    val request = flow.request
    val field = EditText(this).apply {
      setText(request.title)
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE
      filters = arrayOf(InputFilter.LengthFilter(Edits.MAX_TODO))
      contentDescription = "To-do"
    }
    val column = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      val pad = dp(24)
      setPadding(pad, pad, pad, pad)
      addView(text("Add to your to-dos?", 22f))
      addView(text("From ${sourceLabel()}", 16f))
      addView(text("To-do", 14f, top = 20))
      addView(field)
      due(request)?.let { addView(text(it, 16f, top = 12)) }
      request.note?.let {
        addView(text("Note", 14f, top = 20))
        addView(text(it, 16f))
        addView(text("The note is shown here only. It is not saved with the to-do.", 14f, top = 4))
      }
      addView(LinearLayout(this@AddTodoActivity).apply {
        orientation = LinearLayout.HORIZONTAL
        addView(Button(this@AddTodoActivity).apply { text = "Cancel"; setOnClickListener { end() } })
        addView(Button(this@AddTodoActivity).apply { text = "Add"; setOnClickListener { add(flow, field.text.toString()) } })
      }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(24) })
    }
    setContentView(ScrollView(this).apply { fitsSystemWindows = true; addView(column) })
  }

  private fun add(flow: AddTodoFlow, title: String) {
    when (flow.add(title)) {
      AddTodoFlow.Outcome.ADDED -> {
        StoreHolder.onCaptured?.invoke(1)   // refreshes Inflow's own lists when the app is running
        setResult(Activity.RESULT_OK, result(AddTodo.STATUS_DONE, AddTodo.CODE_ADDED))
        finish()
      }
      AddTodoFlow.Outcome.ALREADY_ADDED -> Unit
      AddTodoFlow.Outcome.EMPTY -> Toast.makeText(this, "Write what needs doing first.", Toast.LENGTH_SHORT).show()
      AddTodoFlow.Outcome.LOCKED, AddTodoFlow.Outcome.FAILED -> Toast.makeText(this, "Inflow couldn't save this to-do. Try again.", Toast.LENGTH_LONG).show()
    }
  }

  private fun end() {
    setResult(Activity.RESULT_CANCELED, result(AddTodo.STATUS_CANCELLED, AddTodo.CODE_CANCELLED))
    finish()
  }

  private fun result(status: String, code: String) = Intent().putExtra("status", status).putExtra("code", code)

  // The label of the verified calling package (AppLinkActivityCaller.allowed has checked its certificate), never the `source` extra.
  @Suppress("DEPRECATION")
  private fun sourceLabel(): String = runCatching {
    packageManager.getApplicationLabel(packageManager.getApplicationInfo(callingPackage!!, 0)).toString()
  }.getOrNull()?.takeIf { it.isNotBlank() } ?: "another of your apps"

  private fun due(request: AddTodoRequest): String? =
    request.dueAt?.let { "Due ${DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(it))}" }

  private fun text(value: String, sp: Float, top: Int = 0) = TextView(this).apply {
    text = value
    setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
    setPadding(0, dp(top), 0, 0)
  }

  private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()
}
