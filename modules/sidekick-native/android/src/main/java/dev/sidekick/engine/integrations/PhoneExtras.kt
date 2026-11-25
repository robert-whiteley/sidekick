package dev.sidekick.engine.integrations

import android.app.Activity
import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Phone extras: time to full charge, the step counter, screen time (Usage access), the
 * clipboard, "find my phone" (ring at full alarm volume), opening a link in a given app, and
 * text / links / images shared into Sidekick. All public APIs a Play app may use; nothing here
 * sends anything by itself. JS: src/integrations/extras.ts.
 */
object PhoneExtras {
  private fun start(ctx: Context, activity: Activity?, intent: Intent): Boolean =
    try {
      if (activity != null) activity.startActivity(intent)
      else ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (e: Exception) {
      false
    }

  /** Milliseconds until full while charging (Android 9+), else -1. */
  fun chargeTimeRemaining(ctx: Context): Long {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return -1
    val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
    return try { bm.computeChargeTimeRemaining() } catch (e: Exception) { -1 }
  }

  /** Wall-clock time the phone last started (the step counter counts from here). */
  fun bootAt(): Long = System.currentTimeMillis() - SystemClock.elapsedRealtime()

  fun activityAllowed(ctx: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
      ContextCompat.checkSelfPermission(ctx, "android.permission.ACTIVITY_RECOGNITION") ==
      PackageManager.PERMISSION_GRANTED

  fun hasStepCounter(ctx: Context): Boolean =
    (ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager)
      .getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null

  /**
   * Steps since the phone started, read once from the hardware step counter (it counts in the
   * background with the app closed). Calls back with -1 when there is no sensor, no permission,
   * or no reading within 3 s.
   */
  fun stepCount(ctx: Context, done: (Double) -> Unit) {
    val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    val sensor = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    if (sensor == null || !activityAllowed(ctx)) return done(-1.0)
    val main = Handler(Looper.getMainLooper())
    var finished = false
    lateinit var listener: SensorEventListener
    val finish = { v: Double ->
      if (!finished) {
        finished = true
        sm.unregisterListener(listener)
        done(v)
      }
    }
    listener = object : SensorEventListener {
      override fun onSensorChanged(e: SensorEvent) { main.post { finish(e.values[0].toDouble()) } }
      override fun onAccuracyChanged(s: Sensor?, a: Int) {}
    }
    if (!sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL, main)) return done(-1.0)
    main.postDelayed({ finish(-1.0) }, 3_000)
  }

  fun usageAccess(ctx: Context): Boolean {
    val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
    } else {
      @Suppress("DEPRECATION")
      ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  fun openUsageAccess(ctx: Context, activity: Activity?): Boolean {
    val pkg = Uri.fromParts("package", ctx.packageName, null)
    return start(ctx, activity, Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, pkg)) ||
      start(ctx, activity, Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
  }

  /**
   * Foreground time per app between [from] and [to] from the system's activity events (the same
   * source as Digital Wellbeing, so it matches closely): JSON [{pkg, label, ms}] longest first.
   * Apps without a label (system parts) are left out.
   */
  fun screenTime(ctx: Context, from: Long, to: Long): String {
    val out = JSONArray()
    if (!usageAccess(ctx)) return out.toString()
    val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val events = usm.queryEvents(from, to)
    val openSince = HashMap<String, Long>()
    val total = HashMap<String, Long>()
    val e = UsageEvents.Event()
    @Suppress("DEPRECATION")
    val resumed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) UsageEvents.Event.ACTIVITY_RESUMED else UsageEvents.Event.MOVE_TO_FOREGROUND
    @Suppress("DEPRECATION")
    val paused = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) UsageEvents.Event.ACTIVITY_PAUSED else UsageEvents.Event.MOVE_TO_BACKGROUND
    while (events.hasNextEvent()) {
      events.getNextEvent(e)
      val p = e.packageName ?: continue
      when (e.eventType) {
        resumed -> if (!openSince.containsKey(p)) openSince[p] = e.timeStamp
        paused, UsageEvents.Event.SCREEN_NON_INTERACTIVE -> {
          if (e.eventType == UsageEvents.Event.SCREEN_NON_INTERACTIVE) {
            for ((k, s) in openSince) total[k] = (total[k] ?: 0) + (e.timeStamp - s)
            openSince.clear()
          } else {
            openSince.remove(p)?.let { s -> total[p] = (total[p] ?: 0) + (e.timeStamp - s) }
          }
        }
      }
    }
    // Still open (this app, usually): count up to now.
    for ((k, s) in openSince) total[k] = (total[k] ?: 0) + (to - s)
    val pm = ctx.packageManager
    total.entries.filter { it.value >= 1_000 }.sortedByDescending { it.value }.forEach { (p, ms) ->
      val label = try {
        pm.getApplicationLabel(pm.getApplicationInfo(p, 0)).toString()
      } catch (x: Exception) {
        null
      } ?: return@forEach
      if (pm.getLaunchIntentForPackage(p) == null) return@forEach
      out.put(JSONObject().put("pkg", p).put("label", label).put("ms", ms))
    }
    return out.toString()
  }

  /** The clipboard text (Android only allows this while Sidekick is on screen), or null. */
  fun clipboardText(ctx: Context): String? {
    val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    val clip = cm.primaryClip ?: return null
    if (clip.itemCount == 0) return null
    return clip.getItemAt(0).coerceToText(ctx)?.toString()?.takeIf { it.isNotBlank() }
  }

  fun setClipboard(ctx: Context, text: String): Boolean =
    try {
      val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      cm.setPrimaryClip(ClipData.newPlainText("Sidekick", text))
      true
    } catch (e: Exception) {
      false
    }

  private var ringing: Ringtone? = null
  private var savedAlarmVolume = -1
  private val ringHandler = Handler(Looper.getMainLooper())

  /** "Find my phone": the alarm sound at full alarm volume for [seconds], then volume restored. */
  fun ringPhone(ctx: Context, seconds: Int): Boolean {
    stopRing(ctx)
    val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val uri = RingtoneManager.getActualDefaultRingtoneUri(ctx, RingtoneManager.TYPE_ALARM)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      ?: return false
    val tone = RingtoneManager.getRingtone(ctx, uri) ?: return false
    savedAlarmVolume = am.getStreamVolume(AudioManager.STREAM_ALARM)
    try {
      am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
    } catch (e: SecurityException) {
      // Do Not Disturb may block volume changes; ring at the current volume.
    }
    tone.audioAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) tone.isLooping = true
    tone.play()
    ringing = tone
    ringHandler.postDelayed({ stopRing(ctx) }, seconds.coerceIn(5, 120) * 1000L)
    return true
  }

  fun stopRing(ctx: Context): Boolean {
    ringHandler.removeCallbacksAndMessages(null)
    val r = ringing ?: return false
    r.stop()
    ringing = null
    if (savedAlarmVolume >= 0) {
      try {
        (ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager)
          .setStreamVolume(AudioManager.STREAM_ALARM, savedAlarmVolume, 0)
      } catch (e: SecurityException) {}
      savedAlarmVolume = -1
    }
    return true
  }

  /** Opens [url] in [pkg] (blank: any app that takes it). False if nothing took it. */
  fun openLink(ctx: Context, activity: Activity?, url: String, pkg: String): Boolean {
    val i = Intent(Intent.ACTION_VIEW, Uri.parse(url))
    if (pkg.isNotBlank()) i.setPackage(pkg)
    return start(ctx, activity, i)
  }

  // --- Shared into Sidekick (share sheet) ---

  private var pending: JSONObject? = null

  /**
   * Reads an ACTION_SEND intent: text, subject and the first image (copied into the app cache
   * now, because the read grant ends with the sending app's task). Kept until JS takes it.
   */
  fun noteIntent(ctx: Context, intent: Intent?): Boolean {
    if (intent == null || intent.action != Intent.ACTION_SEND) return false
    val o = JSONObject().put("at", System.currentTimeMillis())
    intent.getStringExtra(Intent.EXTRA_TEXT)?.let { o.put("text", it.take(20_000)) }
    intent.getStringExtra(Intent.EXTRA_SUBJECT)?.let { o.put("subject", it.take(500)) }
    val type = intent.type ?: ""
    if (type.startsWith("image/")) {
      @Suppress("DEPRECATION")
      val uri = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
      else intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
      if (uri != null) copyImage(ctx, uri)?.let { o.put("imagePath", it) }
    }
    if (!o.has("text") && !o.has("imagePath")) return false
    pending = o
    // Handled: a re-delivery (rotation, relaunch from recents) must not share it again.
    intent.action = Intent.ACTION_MAIN
    return true
  }

  private fun copyImage(ctx: Context, uri: Uri): String? =
    try {
      val dir = File(ctx.cacheDir, "shared").apply { mkdirs() }
      dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 86_400_000 }?.forEach { it.delete() }
      val f = File(dir, "share-${System.currentTimeMillis()}.jpg")
      ctx.contentResolver.openInputStream(uri)?.use { input ->
        f.outputStream().use { out ->
          val buf = ByteArray(64 * 1024)
          var total = 0L
          while (true) {
            val n = input.read(buf)
            if (n < 0) break
            total += n
            if (total > 40L * 1024 * 1024) throw IllegalStateException("too big")
            out.write(buf, 0, n)
          }
        }
      } ?: return null
      f.absolutePath
    } catch (e: Exception) {
      null
    }

  fun takeShared(): String? {
    val p = pending ?: return null
    pending = null
    return p.toString()
  }
}
