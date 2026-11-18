package expo.modules.notchisland.core

// The ears fix the clock and battery, so only these two have a row in the card.
fun rowsFor(widgets: List<String>): List<String> = widgets.filter { it == "media" || it == "timer" }
