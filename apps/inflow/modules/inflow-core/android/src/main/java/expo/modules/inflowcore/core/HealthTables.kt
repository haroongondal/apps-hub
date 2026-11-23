package expo.modules.inflowcore.core

// Tables that hold health data. Only the schema and the health stores may name them (HealthSqlWiringTest); V4 proves they stay out of Ask AI and Autopilot.
object HealthTables {
  val ALL = listOf("health_daily", "medicines", "dose_log", "journal")
}
