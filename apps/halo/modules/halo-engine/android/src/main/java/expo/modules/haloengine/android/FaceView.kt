package expo.modules.haloengine.android

import android.app.AlarmManager
import android.content.Context
import android.graphics.Canvas
import android.os.BatteryManager
import android.text.format.DateFormat
import android.view.View
import expo.modules.haloengine.core.BurnIn
import expo.modules.haloengine.core.DrawList
import expo.modules.haloengine.core.Face
import expo.modules.haloengine.core.FaceInput
import expo.modules.haloengine.core.FaceOptions
import expo.modules.haloengine.core.Faces
import expo.modules.haloengine.core.timeText
import java.util.Calendar
import java.util.Locale

// The face is rebuilt once per minute (per second with seconds on), never per frame; onDraw only shifts and paints it.
class FaceView(ctx: Context) : View(ctx) {
  private val painter = OpPainter(ctx)
  private val list = DrawList()
  private var face: Face = Faces.create("")
  private val input = FaceInput(0, 0, 0, "", 0, false, null, intArrayOf(0xFFFFFFFF.toInt()), 0f, 0f, 0f, 0f, FaceOptions())
  private val now = Calendar.getInstance()
  private val alarm = Calendar.getInstance()
  private val shift = FloatArray(2)
  private val maxShiftPx = 12 * resources.displayMetrics.density
  private val battery = ctx.getSystemService(BatteryManager::class.java)
  private val alarms = ctx.getSystemService(AlarmManager::class.java)
  private val tick = Runnable { update() }

  fun apply(faceId: String, options: FaceOptions, colours: IntArray) {
    face = Faces.create(faceId)
    input.options = options
    input.colours = colours
    update()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    update()
  }

  override fun onDetachedFromWindow() {
    removeCallbacks(tick)
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) = update()

  private fun update() {
    removeCallbacks(tick)
    if (!isAttachedToWindow || width == 0 || height == 0) return
    val ms = System.currentTimeMillis()
    now.timeInMillis = ms
    val o = input.options
    input.hour = now.get(Calendar.HOUR_OF_DAY)
    input.minute = now.get(Calendar.MINUTE)
    input.second = now.get(Calendar.SECOND)
    input.dateText = DateFormat.format(DateFormat.getBestDateTimePattern(Locale.getDefault(), "EEEdMMM"), now).toString()
    input.batteryPct = battery?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.coerceIn(0, 100) ?: 0
    input.charging = battery?.isCharging == true
    input.alarmText = if (o.alarm) alarms?.nextAlarmClock?.let {
      alarm.timeInMillis = it.triggerTime
      timeText(alarm.get(Calendar.HOUR_OF_DAY), alarm.get(Calendar.MINUTE), o.h24)
    } else null
    // Twice the burn-in reach keeps shifted content clear of rounded corners and the cutout.
    val inset = 2 * maxShiftPx
    input.left = paddingLeft + inset
    input.top = paddingTop + inset
    input.right = width - paddingRight - inset
    input.bottom = height - paddingBottom - inset
    list.clear()
    face.draw(input, list)
    invalidate()
    val period = if (o.seconds && face.supportsSeconds) 1_000L else 60_000L
    postDelayed(tick, period - ms % period)
  }

  override fun onDraw(canvas: Canvas) {
    BurnIn.offset(System.currentTimeMillis(), maxShiftPx, shift)
    canvas.save()
    canvas.translate(shift[0], shift[1])
    for (i in 0 until list.opCount) painter.draw(canvas, null, list, i, 1f)
    canvas.restore()
  }
}
