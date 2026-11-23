package expo.modules.placereminders.core

data class PlaceReminder(
  val id: String,
  val itemId: String,
  val title: String,
  val lat: Double,
  val lng: Double,
  val radiusM: Int,
  val trigger: String,
)
