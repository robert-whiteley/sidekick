package dev.sidekick.engine

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.Calendar
import org.json.JSONObject

/**
 * Where the phone is, from Android's own LocationManager (no Google Play services, no network
 * geocoding: place names are looked up offline in JS). Also decides when listening auto-pauses:
 * quiet hours and places the user picked.
 */
object Places {
  private const val TAG = "SidekickPlaces"
  /** Location updates while listening: at most every 5 minutes or 100 m. */
  private const val MIN_TIME_MS = 5 * 60_000L
  private const val MIN_DISTANCE_M = 100f
  /** A fix older than this isn't used to tag new memories. */
  const val MAX_AGE_MS = 2 * 60 * 60_000L

  @Volatile var last: Location? = null
    private set

  private data class PausePlace(val name: String, val lat: Double, val lon: Double, val radiusM: Double)

  @Volatile private var quietStart = -1
  @Volatile private var quietEnd = -1
  @Volatile private var pausePlaces: List<PausePlace> = emptyList()

  private val listener = LocationListener { loc -> offer(loc) }
  private var tracking = false

  /** While tracking: fixes go to the journal (JS stores them as the location track). */
  @Volatile private var appCtx: Context? = null
  private var lastJournaled: Location? = null
  /** Stationary phones send no updates: ask for a fresh fix this often while listening. */
  private const val HEARTBEAT_MS = 15 * 60_000L
  private val handler = Handler(Looper.getMainLooper())
  private val heartbeat =
    object : Runnable {
      override fun run() {
        appCtx?.let { current(it) }
        handler.postDelayed(this, HEARTBEAT_MS)
      }
    }

  /** Car kits by Bluetooth name (pattern from JS, hands-free-logic.ts); null = no parking marks. */
  @Volatile var carPattern: Regex? = null

  private val audioCallback =
    object : AudioDeviceCallback() {
      override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) {
        val pat = carPattern ?: return
        val car =
          removed.any {
            (it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) &&
              pat.containsMatchIn(it.productName?.toString() ?: "")
          }
        if (car) markParked()
      }
    }
  private var parkedPending = false

  fun hasPermission(ctx: Context): Boolean =
    ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
      ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  private fun offer(loc: Location) {
    val cur = last
    if (cur == null || loc.time >= cur.time) last = loc
    val ctx = appCtx ?: return
    if (parkedPending && System.currentTimeMillis() - loc.time < 60_000) {
      parkedPending = false
      journal(ctx, loc, "parked")
    }
    val prev = lastJournaled
    if (prev != null && (loc.time <= prev.time || (loc.distanceTo(prev) < 40f && loc.time - prev.time < 4 * 60_000L))) return
    if (loc.hasAccuracy() && loc.accuracy > 500f) return
    lastJournaled = loc
    journal(ctx, loc, "fix")
  }

  private fun journal(ctx: Context, loc: Location, source: String) {
    val e =
      JSONObject()
        .put("kind", "location")
        .put("at", if (source == "parked") System.currentTimeMillis() else loc.time)
        .put("lat", loc.latitude)
        .put("lon", loc.longitude)
        .put("source", source)
    if (loc.hasAccuracy()) e.put("accM", loc.accuracy.toDouble())
    if (loc.hasSpeed()) e.put("speedMs", loc.speed.toDouble())
    runCatching { Journal.append(ctx, e) }.onFailure { Log.w(TAG, "journal failed", it) }
  }

  /** The car's Bluetooth went away: where the phone is now is where the car was left. */
  private fun markParked() {
    val ctx = appCtx ?: return
    val l = last
    if (l != null && System.currentTimeMillis() - l.time < 2 * 60_000L) journal(ctx, l, "parked")
    parkedPending = true
    current(ctx)
  }

  /** Starts low-power updates (network + GPS + whatever other apps already requested). */
  @SuppressLint("MissingPermission")
  @Synchronized
  fun startTracking(ctx: Context) {
    if (tracking || !hasPermission(ctx)) return
    val lm = ctx.getSystemService(LocationManager::class.java) ?: return
    refreshLastKnown(ctx)
    for (p in listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER, LocationManager.PASSIVE_PROVIDER)) {
      runCatching {
        if (p == LocationManager.PASSIVE_PROVIDER || lm.isProviderEnabled(p)) {
          lm.requestLocationUpdates(p, MIN_TIME_MS, MIN_DISTANCE_M, listener, Looper.getMainLooper())
        }
      }.onFailure { Log.w(TAG, "no updates from $p", it) }
    }
    appCtx = ctx.applicationContext
    handler.postDelayed(heartbeat, HEARTBEAT_MS)
    runCatching { ctx.getSystemService(AudioManager::class.java)?.registerAudioDeviceCallback(audioCallback, handler) }
    tracking = true
  }

  @Synchronized
  fun stopTracking(ctx: Context) {
    if (!tracking) return
    runCatching { ctx.getSystemService(LocationManager::class.java)?.removeUpdates(listener) }
    handler.removeCallbacks(heartbeat)
    runCatching { ctx.getSystemService(AudioManager::class.java)?.unregisterAudioDeviceCallback(audioCallback) }
    appCtx = null
    parkedPending = false
    tracking = false
  }

  @SuppressLint("MissingPermission")
  private fun refreshLastKnown(ctx: Context) {
    if (!hasPermission(ctx)) return
    val lm = ctx.getSystemService(LocationManager::class.java) ?: return
    for (p in runCatching { lm.getProviders(true) }.getOrDefault(emptyList())) {
      runCatching { lm.getLastKnownLocation(p) }.getOrNull()?.let(::offer)
    }
  }

  /**
   * The freshest location we know, or null. Also asks for a new fix in the background (Android
   * 11+), so the next memory gets a more current place.
   */
  @SuppressLint("MissingPermission")
  fun current(ctx: Context): Location? {
    if (!hasPermission(ctx)) return null
    refreshLastKnown(ctx)
    if (Build.VERSION.SDK_INT >= 30) {
      val lm = ctx.getSystemService(LocationManager::class.java)
      val provider =
        listOf("fused", LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
          .firstOrNull { runCatching { lm?.isProviderEnabled(it) == true }.getOrDefault(false) }
      if (lm != null && provider != null) {
        runCatching {
          lm.getCurrentLocation(provider, null, ctx.mainExecutor) { loc -> loc?.let(::offer) }
        }
      }
    }
    val l = last ?: return null
    return if (System.currentTimeMillis() - l.time <= MAX_AGE_MS) l else null
  }

  /** Puts lat/lon on a journal entry when we have a recent fix. */
  fun tag(entry: JSONObject): JSONObject {
    val l = last ?: return entry
    if (System.currentTimeMillis() - l.time > MAX_AGE_MS) return entry
    return entry.put("lat", l.latitude).put("lon", l.longitude)
  }

  /** Rules from JS: {"quietStart": minutes or -1, "quietEnd": minutes, "places": [{name, lat, lon, radiusM}]}. */
  fun setRules(json: String) {
    val o = runCatching { JSONObject(json) }.getOrNull() ?: return
    quietStart = o.optInt("quietStart", -1)
    quietEnd = o.optInt("quietEnd", -1)
    val arr = o.optJSONArray("places")
    pausePlaces =
      (0 until (arr?.length() ?: 0)).mapNotNull { i ->
        val p = arr!!.optJSONObject(i) ?: return@mapNotNull null
        PausePlace(p.optString("name"), p.optDouble("lat"), p.optDouble("lon"), p.optDouble("radiusM", 150.0))
      }
  }

  /** Why listening is paused right now ("quiet hours", "at Work"), or null when it isn't. */
  fun pauseReason(): String? {
    if (quietStart >= 0 && quietEnd >= 0 && quietStart != quietEnd) {
      val c = Calendar.getInstance()
      val now = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
      val quiet = if (quietStart < quietEnd) now in quietStart until quietEnd else now >= quietStart || now < quietEnd
      if (quiet) return "quiet hours"
    }
    val l = last
    if (l != null && System.currentTimeMillis() - l.time <= MAX_AGE_MS) {
      for (p in pausePlaces) {
        val d = FloatArray(1)
        Location.distanceBetween(l.latitude, l.longitude, p.lat, p.lon, d)
        if (d[0] <= p.radiusM + minOf(l.accuracy, 100f)) return "at ${p.name}"
      }
    }
    return null
  }
}
