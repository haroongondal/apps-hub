package expo.modules.notchisland.core

data class Ears(val time: Boolean, val battery: Boolean, val dateLine: Boolean)

// Clock sits in the left ear, battery in the right; the date and alarm line appears only with the clock.
fun earLayout(widgets: List<String>): Ears {
  val clock = "clock" in widgets
  return Ears(time = clock, battery = "battery" in widgets, dateLine = clock)
}
