package dev.sidekick.engine.routines

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Routines (src/engine/routines.ts decides everything; this side only wakes JS up):
 * - one alarm at the next scheduled routine (exact when "Alarms & reminders" is allowed);
 * - message notifications matched against the routines' rules (works with the app closed, as
 *   the notification listener is bound by Android);
 * - charging, first unlock and headphones while Sidekick's process is alive.
 * Each event starts RoutineTaskService, which runs the JS task "SidekickRoutine".
 */
object Routines {
  private const val TAG = "SidekickRoutines"
  private const val PREFS = "sidekick.routines"
  private const val KEY_PLAN = "plan"
  const val ACTION_ALARM = "dev.sidekick.ROUTINE_ALARM"
  private const val CHANNEL = "routines"
  private const val FALLBACK_ID = 4711

  private fun plan(ctx: Context): JSONObject =
    try {
      JSONObject(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_PLAN, "{}") ?: "{}")
    } catch (e: Exception) {
      JSONObject()
    }

  /** JS hands over {alarms:[{id,at}], messages:[{id,who,app}], triggers:["charging",…]}. */
  fun setPlan(ctx: Context, json: String) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_PLAN, json).apply()
    arm(ctx)
    registerDynamic(ctx)
  }

  fun canExact(ctx: Context): Boolean {
    if (Build.VERSION.SDK_INT < 31) return true
    return ctx.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
  }

  private fun alarmIntent(ctx: Context): PendingIntent =
    PendingIntent.getBroadcast(
      ctx,
      0,
      Intent(ctx, RoutineReceiver::class.java).setAction(ACTION_ALARM),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  /** Sets the one alarm at the earliest future routine time (or clears it). */
  fun arm(ctx: Context) {
    val am = ctx.getSystemService(AlarmManager::class.java) ?: return
    val alarms = plan(ctx).optJSONArray("alarms") ?: JSONArray()
    val now = System.currentTimeMillis()
    var next = Long.MAX_VALUE
    for (i in 0 until alarms.length()) {
      val at = alarms.optJSONObject(i)?.optLong("at") ?: continue
      if (at > now && at < next) next = at
    }
    val pi = alarmIntent(ctx)
    am.cancel(pi)
    if (next == Long.MAX_VALUE) return
    try {
      if (canExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi)
      else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi)
    } catch (e: SecurityException) {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi)
    }
  }

  /** Runs the JS task with [payload]; if Android won't start it, a notification says to open the app. */
  fun start(ctx: Context, payload: JSONObject) {
    val i = Intent(ctx, RoutineTaskService::class.java).putExtra("payload", payload.toString())
    try {
      ContextCompat.startForegroundService(ctx, i)
    } catch (e: Exception) {
      Log.w(TAG, "could not start routine task", e)
      if (payload.optString("type") == "time") fallback(ctx)
    }
  }

  fun ensureChannel(ctx: Context) {
    val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL, "Routines", NotificationManager.IMPORTANCE_DEFAULT).apply {
          description = "Results of the routines you set up"
        }
      )
    }
  }

  fun channel() = CHANNEL

  private fun fallback(ctx: Context) {
    ensureChannel(ctx)
    val open =
      PendingIntent.getActivity(
        ctx,
        7,
        ctx.packageManager.getLaunchIntentForPackage(ctx.packageName),
        PendingIntent.FLAG_IMMUTABLE,
      )
    val n: Notification =
      NotificationCompat.Builder(ctx, CHANNEL)
        .setSmallIcon(android.R.drawable.ic_popup_reminder)
        .setContentTitle("A routine is due")
        .setContentText("Open Sidekick to run it.")
        .setContentIntent(open)
        .setAutoCancel(true)
        .build()
    try {
      ctx.getSystemService(NotificationManager::class.java)?.notify(FALLBACK_ID, n)
    } catch (e: SecurityException) {
      // No notification permission: it runs when the app is next opened.
    }
  }

  // --- Message notifications (called by SidekickNotificationListener) ---

  fun onNotification(ctx: Context, sbn: StatusBarNotification) {
    try {
      val rules = plan(ctx).optJSONArray("messages") ?: return
      if (rules.length() == 0) return
      if (sbn.packageName == ctx.packageName || sbn.isOngoing) return
      val n = sbn.notification ?: return
      if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
      val extras = n.extras ?: return
      val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
      val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
      if (title.isNullOrBlank()) return
      val app =
        try {
          val pm = ctx.packageManager
          pm.getApplicationLabel(pm.getApplicationInfo(sbn.packageName, 0)).toString()
        } catch (e: Exception) {
          null
        }
      // Only conversations: the message style or category, or a known messaging app.
      val isMessage =
        n.category == Notification.CATEGORY_MESSAGE ||
          n.category == Notification.CATEGORY_EMAIL ||
          extras.containsKey(Notification.EXTRA_MESSAGES)
      if (!isMessage) return
      val ids = JSONArray()
      for (i in 0 until rules.length()) {
        val r = rules.optJSONObject(i) ?: continue
        if (matches(r.optString("who").ifBlank { null }, r.optString("app").ifBlank { null }, title, app, sbn.packageName))
          ids.put(r.optString("id"))
      }
      if (ids.length() == 0) return
      start(
        ctx,
        JSONObject()
          .put("type", "message")
          .put("ids", ids)
          .put("title", title)
          .put("text", text)
          .put("app", app)
          .put("pkg", sbn.packageName)
          .put("at", sbn.postTime),
      )
    } catch (e: Exception) {
      Log.w(TAG, "notification check failed", e)
    }
  }

  /** Same rule as messageMatches in routines-logic.ts. */
  fun matches(who: String?, app: String?, title: String?, appLabel: String?, pkg: String?): Boolean {
    val t = (title ?: "").lowercase()
    if (app != null) {
      val a = when (app) { "sms", "messages" -> "messag"; "email" -> "mail"; else -> app }
      if (!(appLabel ?: "").lowercase().contains(a) && !(pkg ?: "").lowercase().contains(a.replace(" ", ""))) return false
    }
    if (who != null) {
      val first = who.lowercase().split(Regex("\\s+")).first()
      if (!Regex("\\b${Regex.escape(first)}\\b").containsMatchIn(t)) return false
    }
    return true
  }

  // --- Charging, unlock, headphones (while the process is alive) ---

  @Volatile private var registered = false

  private fun wants(ctx: Context, type: String): Boolean {
    val t = plan(ctx).optJSONArray("triggers") ?: return false
    for (i in 0 until t.length()) if (t.optString(i) == type) return true
    return false
  }

  fun registerDynamic(context: Context) {
    if (registered) return
    registered = true
    val ctx = context.applicationContext
    val receiver =
      object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
          val type =
            when (intent.action) {
              Intent.ACTION_POWER_CONNECTED -> "charging"
              Intent.ACTION_USER_PRESENT -> "unlock"
              else -> return
            }
          if (wants(ctx, type)) start(ctx, JSONObject().put("type", type).put("at", System.currentTimeMillis()))
        }
      }
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_POWER_CONNECTED)
      addAction(Intent.ACTION_USER_PRESENT)
    }
    ContextCompat.registerReceiver(ctx, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    val audio = ctx.getSystemService(AudioManager::class.java) ?: return
    var initial = true
    audio.registerAudioDeviceCallback(
      object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) {
          // The first call lists what is already connected: not a new connection.
          if (initial) {
            initial = false
            return
          }
          val d = added.firstOrNull { isHeadphones(it) } ?: return
          if (!wants(ctx, "headphones") && !wants(ctx, "car")) return
          start(
            ctx,
            JSONObject()
              .put("type", "device")
              .put("name", d.productName?.toString() ?: "")
              .put("bluetooth", d.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || d.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
              .put("at", System.currentTimeMillis()),
          )
        }
      },
      Handler(Looper.getMainLooper()),
    )
  }

  private fun isHeadphones(d: AudioDeviceInfo): Boolean {
    if (!d.isSink) return false
    val t = d.type
    return t == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
      t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
      t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
      t == AudioDeviceInfo.TYPE_USB_HEADSET ||
      (Build.VERSION.SDK_INT >= 31 && t == AudioDeviceInfo.TYPE_BLE_HEADSET)
  }
}
