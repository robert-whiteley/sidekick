package dev.sidekick.engine.offline

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * Work that waits for the internet (src/engine/online-queue.ts) and network routines ("when I'm
 * back online / on Wi-Fi / leave Wi-Fi"), also with the app closed:
 * - something queued while offline → a one-time WorkManager job that runs once connected;
 * - a Wi-Fi routine while not on Wi-Fi → a one-time job that runs once on an unmetered network;
 * - either of the above, or offline/leave-Wi-Fi routines → a 15-minute check (WorkManager's
 *   minimum) that wakes JS only when the state changed.
 * While the process is alive a network callback reports changes at once.
 * Each wake-up runs the JS task "SidekickRoutine" with {type:"network", online, wifi}.
 */
object Offline {
  private const val TAG = "SidekickOffline"
  private const val PREFS = "sidekick.offline"
  const val TASK = "SidekickRoutine"
  private const val WORK_ONLINE = "sidekick-online"
  private const val WORK_WIFI = "sidekick-wifi"
  private const val WORK_WATCH = "sidekick-net-watch"

  data class State(val online: Boolean, val wifi: Boolean)

  fun state(ctx: Context): State {
    val cm = ctx.getSystemService(ConnectivityManager::class.java) ?: return State(false, false)
    val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return State(false, false)
    val online =
      caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
        caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    val wifi =
      caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    return State(online, online && wifi)
  }

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** What JS needs: {pending: n, online: bool, wifi: bool, offline: bool, wifiLeave: bool}. */
  private fun config(ctx: Context): JSONObject =
    try {
      JSONObject(prefs(ctx).getString("config", "{}") ?: "{}")
    } catch (e: Exception) {
      JSONObject()
    }

  /** Last state JS was told about ("" = never). */
  private fun lastSent(ctx: Context): String = prefs(ctx).getString("sent", "") ?: ""

  private fun key(s: State) = "${if (s.online) 1 else 0}${if (s.wifi) 1 else 0}"

  /** From JS: what is waiting and which network routines exist; (re)plans the jobs. */
  fun configure(ctx: Context, json: String) {
    prefs(ctx).edit().putString("config", json).apply()
    plan(ctx)
  }

  /** JS handled this state (it was online / on Wi-Fi when it ran). */
  fun markSent(ctx: Context, online: Boolean, wifi: Boolean) {
    prefs(ctx).edit().putString("sent", key(State(online, wifi))).apply()
  }

  fun plan(ctx: Context) {
    val c = config(ctx)
    val pending = c.optInt("pending", 0) > 0
    val wantsOnline = c.optBoolean("online", false)
    val wantsWifi = c.optBoolean("wifi", false)
    val wantsChange = c.optBoolean("offline", false) || c.optBoolean("wifiLeave", false)
    val s = state(ctx)
    val wm =
      try {
        WorkManager.getInstance(ctx)
      } catch (e: Exception) {
        Log.w(TAG, "WorkManager unavailable", e)
        return
      }
    if ((pending || wantsOnline) && !s.online) {
      val req =
        OneTimeWorkRequestBuilder<NetWorker>()
          .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
          .build()
      wm.enqueueUniqueWork(WORK_ONLINE, ExistingWorkPolicy.KEEP, req)
    } else {
      wm.cancelUniqueWork(WORK_ONLINE)
    }
    if (wantsWifi && !s.wifi) {
      val req =
        OneTimeWorkRequestBuilder<NetWorker>()
          .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).build())
          .build()
      wm.enqueueUniqueWork(WORK_WIFI, ExistingWorkPolicy.KEEP, req)
    } else {
      wm.cancelUniqueWork(WORK_WIFI)
    }
    if (pending || wantsOnline || wantsWifi || wantsChange) {
      val req = PeriodicWorkRequestBuilder<NetWorker>(15, TimeUnit.MINUTES).build()
      wm.enqueueUniquePeriodicWork(WORK_WATCH, ExistingPeriodicWorkPolicy.KEEP, req)
    } else {
      wm.cancelUniqueWork(WORK_WATCH)
    }
  }

  /** Should JS be woken for [s]? Only when it changed since JS last saw it, or work is waiting. */
  fun shouldWake(ctx: Context, s: State): Boolean {
    val c = config(ctx)
    if (c.optInt("pending", 0) > 0 && s.online) return true
    val last = lastSent(ctx)
    if (last == key(s)) return false
    // Nothing listens for this change: remember it without waking JS.
    val wants =
      c.optBoolean("online", false) || c.optBoolean("wifi", false) ||
        c.optBoolean("offline", false) || c.optBoolean("wifiLeave", false)
    if (!wants) {
      prefs(ctx).edit().putString("sent", key(s)).apply()
      return false
    }
    return true
  }

  fun payload(s: State): String =
    JSONObject()
      .put("type", "network")
      .put("online", s.online)
      .put("wifi", s.wifi)
      .put("at", System.currentTimeMillis())
      .toString()

  // --- While the process is alive: changes at once ---

  @Volatile private var watching = false

  fun watch(context: Context) {
    if (watching) return
    watching = true
    val ctx = context.applicationContext
    val cm = ctx.getSystemService(ConnectivityManager::class.java) ?: return
    try {
      cm.registerDefaultNetworkCallback(
        object : ConnectivityManager.NetworkCallback() {
          override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = changed()

          override fun onLost(network: Network) = changed()

          private fun changed() {
            val s = state(ctx)
            if (!shouldWake(ctx, s)) return
            NetWorker.runNow(ctx, s)
          }
        }
      )
    } catch (e: Exception) {
      Log.w(TAG, "network callback failed", e)
    }
  }
}
