package expo.modules.inflowcore.android

import android.app.Activity
import android.os.Bundle
import android.util.TypedValue
import android.widget.ScrollView
import android.widget.TextView

class HealthRationaleActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    title = "Inflow and your health data"
    val pad = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 24f, resources.displayMetrics).toInt()
    val text = TextView(this).apply {
      text = TEXT
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
      setLineSpacing(0f, 1.25f)
      setPadding(pad, pad, pad, pad)
    }
    setContentView(ScrollView(this).apply {
      fitsSystemWindows = true
      addView(text)
    })
  }

  companion object {
    val TEXT = listOf(
      "Inflow reads your steps, sleep and heart rate from Health Connect. It never writes anything there.",
      "Inflow keeps one total for each day: steps, minutes asleep, and the average and lowest heart rate. They are saved encrypted on this phone only.",
      "Your numbers leave this phone in two ways only. A Doctor summary, after you read the exact text and tap Send. And, only if you turn it on in Settings, Ask AI gets daily step, sleep and heart rate numbers, never your journal or medicine names.",
      "Inflow is not a medical device. It gives no medical advice and does not diagnose anything.",
      "You can take this access away at any time in Health Connect.",
    ).joinToString("\n\n")
  }
}
