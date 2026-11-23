package expo.modules.inflowcore.core

// Tables that hold health data. Only the schema and the health stores may name them (HealthSqlWiringTest); V4 proves they stay out of Ask AI and Autopilot, and the morning briefing reads them only through StoreBriefingHealth while its setting is on (VitalsSqlWiringTest).
object HealthTables {
  val ALL = listOf("health_daily", "medicines", "dose_log", "journal")
}
