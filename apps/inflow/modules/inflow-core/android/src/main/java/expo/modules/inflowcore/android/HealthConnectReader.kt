package expo.modules.inflowcore.android

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import expo.modules.inflowcore.core.HealthAggregate
import expo.modules.inflowcore.core.HrSample
import expo.modules.inflowcore.core.SleepSession
import expo.modules.inflowcore.core.SleepStage
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.reflect.KClass

object HealthConnectReader {
  val STEPS = HealthPermission.getReadPermission(StepsRecord::class)
  val SLEEP = HealthPermission.getReadPermission(SleepSessionRecord::class)
  val HEART_RATE = HealthPermission.getReadPermission(HeartRateRecord::class)
  val PERMISSIONS = setOf(STEPS, SLEEP, HEART_RATE)

  private const val DAY_MS = 86_400_000L
  private val AWAKE = setOf(SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED, SleepSessionRecord.STAGE_TYPE_OUT_OF_BED)

  const val NOT_AVAILABLE = "Health Connect isn't ready on this phone."
  const val NOT_ALLOWED = "Allow Inflow to read steps, sleep or heart rate first."
  const val FAILED = "Inflow couldn't read Health Connect. Try again."

  fun availability(context: Context): String = when (HealthConnectClient.getSdkStatus(context)) {
    HealthConnectClient.SDK_AVAILABLE -> "available"
    HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update"
    else -> "missing"
  }

  suspend fun granted(context: Context): Set<String> =
    if (availability(context) != "available") emptySet()
    else HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions().intersect(PERMISSIONS)

  suspend fun status(context: Context): Map<String, Any?> {
    val g = granted(context)
    return mapOf("availability" to availability(context), "steps" to (STEPS in g), "sleep" to (SLEEP in g), "heartRate" to (HEART_RATE in g))
  }

  suspend fun refresh(context: Context, store: SqlItemStore, days: Int): Map<String, Any?> {
    if (availability(context) != "available") return result(false, NOT_AVAILABLE, 0)
    return try {
      val client = HealthConnectClient.getOrCreate(context)
      val granted = client.permissionController.getGrantedPermissions()
      val zone = ZoneId.systemDefault()
      val windows = HealthAggregate.windows(LocalDate.now(zone), days, zone)

      val steps = mutableMapOf<LocalDate, Long>()
      val hrAvg = mutableMapOf<LocalDate, Long>()
      val metrics = buildSet { if (STEPS in granted) add(StepsRecord.COUNT_TOTAL); if (HEART_RATE in granted) add(HeartRateRecord.BPM_AVG) }
      if (metrics.isNotEmpty()) {
        for (w in windows) {
          val r = client.aggregate(AggregateRequest(metrics, TimeRangeFilter.between(Instant.ofEpochMilli(w.startMs), Instant.ofEpochMilli(w.endMs))))
          if (StepsRecord.COUNT_TOTAL in metrics) r[StepsRecord.COUNT_TOTAL]?.let { steps[w.day] = it }
          if (HeartRateRecord.BPM_AVG in metrics) r[HeartRateRecord.BPM_AVG]?.let { hrAvg[w.day] = it }
        }
      }
      val from = windows.first().startMs
      val to = windows.last().endMs
      val samples = if (HEART_RATE in granted) {
        readAll(client, HeartRateRecord::class, from, to).flatMap { r -> r.samples.map { HrSample(it.time.toEpochMilli(), it.beatsPerMinute.toInt()) } }
      } else emptyList()
      // A night ending on the first day started the day before.
      val sleep = if (SLEEP in granted) {
        readAll(client, SleepSessionRecord::class, from - DAY_MS, to).map { r ->
          SleepSession(r.startTime.toEpochMilli(), r.endTime.toEpochMilli(), r.stages.map { SleepStage(it.startTime.toEpochMilli(), it.endTime.toEpochMilli(), it.stage !in AWAKE) })
        }
      } else emptyList()

      val rows = HealthAggregate.days(windows, steps, hrAvg, samples, sleep)
      store.inTransaction { HealthAggregate.save(SqlHealthStore(store.db), windows, rows, System.currentTimeMillis()) }
      if (granted.intersect(PERMISSIONS).isEmpty()) result(false, NOT_ALLOWED, 0) else result(true, null, rows.size)
    } catch (e: Exception) {
      Log.w("HealthConnectReader", "refresh failed: ${e.javaClass.simpleName}")
      result(false, FAILED, 0)
    }
  }

  private fun result(ok: Boolean, message: String?, days: Int) = mapOf("ok" to ok, "message" to message, "days" to days)

  private suspend fun <T : Record> readAll(client: HealthConnectClient, type: KClass<T>, fromMs: Long, toMs: Long): List<T> {
    val range = TimeRangeFilter.between(Instant.ofEpochMilli(fromMs), Instant.ofEpochMilli(toMs))
    val out = mutableListOf<T>()
    var token: String? = null
    do {
      val page = client.readRecords(ReadRecordsRequest(type, range, emptySet(), true, 1000, token))
      out += page.records
      token = page.pageToken
    } while (!token.isNullOrEmpty())
    return out
  }

  class PermissionContract : AppContextActivityResultContract<ArrayList<String>, Set<String>> {
    private val contract = PermissionController.createRequestPermissionResultContract()

    override fun createIntent(context: Context, input: ArrayList<String>): Intent = contract.createIntent(context, input.toSet())

    override fun parseResult(input: ArrayList<String>, resultCode: Int, intent: Intent?): Set<String> = contract.parseResult(resultCode, intent)
  }
}
