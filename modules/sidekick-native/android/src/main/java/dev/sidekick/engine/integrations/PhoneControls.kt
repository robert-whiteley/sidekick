package dev.sidekick.engine.integrations

import android.app.Activity
import android.app.KeyguardManager
import android.app.NotificationManager
import android.app.SearchManager
import android.content.Context
import android.content.Intent
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject

/**
 * Phone controls an assistant is expected to have: open an app, torch, volume, Do Not Disturb,
 * brightness, quick-settings panels, "play X on Y", and lock-screen checks. Everything here is a
 * public Android API a Play app may use; Wi-Fi, Bluetooth, mobile data and airplane mode can't
 * be switched by apps (Android 10+), so those open the system panel instead.
 * JS: src/integrations/phone-controls.ts.
 */
object PhoneControls {
  private fun start(ctx: Context, activity: Activity?, intent: Intent): Boolean =
    try {
      if (activity != null) activity.startActivity(intent)
      else ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (e: Exception) {
      false
    }

  /** Apps with a home-screen icon: [{label, pkg}] (needs the launcher <queries> entry). */
  fun launchableApps(ctx: Context): String {
    val pm = ctx.packageManager
    val main = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val out = JSONArray()
    val seen = HashSet<String>()
    for (ri in pm.queryIntentActivities(main, 0)) {
      val pkg = ri.activityInfo?.packageName ?: continue
      if (pkg == ctx.packageName || !seen.add(pkg)) continue
      out.put(JSONObject().put("label", ri.loadLabel(pm).toString()).put("pkg", pkg))
    }
    return out.toString()
  }

  fun openApp(ctx: Context, activity: Activity?, pkg: String): Boolean {
    val i = ctx.packageManager.getLaunchIntentForPackage(pkg) ?: return false
    return start(ctx, activity, i)
  }

  @Volatile private var torchOn = false

  /** on = null toggles. Returns the new state, or null when the phone has no torch / it's busy. */
  fun flashlight(ctx: Context, on: Boolean?): Boolean? {
    val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    return try {
      val id = cm.cameraIdList.firstOrNull {
        cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
      } ?: return null
      val want = on ?: !torchOn
      cm.setTorchMode(id, want)
      torchOn = want
      want
    } catch (e: Exception) {
      null
    }
  }

  /** dir: up | down | mute | unmute | max. Media volume, with the system slider shown. Returns 0-100. */
  fun volume(ctx: Context, dir: String, percent: Int): Int {
    val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val s = AudioManager.STREAM_MUSIC
    val flags = AudioManager.FLAG_SHOW_UI
    val max = am.getStreamMaxVolume(s).coerceAtLeast(1)
    try {
      when (dir) {
        "up" -> repeat(2) { am.adjustStreamVolume(s, AudioManager.ADJUST_RAISE, flags) }
        "down" -> repeat(2) { am.adjustStreamVolume(s, AudioManager.ADJUST_LOWER, flags) }
        "mute" -> am.adjustStreamVolume(s, AudioManager.ADJUST_MUTE, flags)
        "unmute" -> am.adjustStreamVolume(s, AudioManager.ADJUST_UNMUTE, flags)
        "max" -> am.setStreamVolume(s, max, flags)
        "set" -> am.setStreamVolume(s, (percent.coerceIn(0, 100) * max + 50) / 100, flags)
      }
    } catch (e: SecurityException) {
      // Changing volume while Do Not Disturb is on can be refused.
    }
    return am.getStreamVolume(s) * 100 / max
  }

  private fun nm(ctx: Context) = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  fun dndAccess(ctx: Context): Boolean = nm(ctx).isNotificationPolicyAccessGranted

  fun openDndAccess(ctx: Context, activity: Activity?): Boolean =
    start(ctx, activity, Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))

  /** Priority only (calls/messages from starred contacts and alarms) or everything. */
  fun setDnd(ctx: Context, on: Boolean): Boolean {
    val m = nm(ctx)
    if (!m.isNotificationPolicyAccessGranted) return false
    m.setInterruptionFilter(
      if (on) NotificationManager.INTERRUPTION_FILTER_PRIORITY else NotificationManager.INTERRUPTION_FILTER_ALL,
    )
    return true
  }

  fun canWriteSettings(ctx: Context): Boolean = Settings.System.canWrite(ctx)

  fun openWriteSettings(ctx: Context, activity: Activity?): Boolean =
    start(
      ctx,
      activity,
      Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:${ctx.packageName}")),
    )

  /** Screen brightness 0-100 (readable without permission); -1 when automatic. */
  fun brightness(ctx: Context): Int =
    try {
      val cr = ctx.contentResolver
      if (Settings.System.getInt(cr, Settings.System.SCREEN_BRIGHTNESS_MODE, 0) == Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC) -1
      else Settings.System.getInt(cr, Settings.System.SCREEN_BRIGHTNESS, 128) * 100 / 255
    } catch (e: Exception) {
      -1
    }

  /** percent 0-100, or -1 for automatic. Returns false without the "Modify system settings" permission. */
  fun setBrightness(ctx: Context, percent: Int): Boolean {
    if (!Settings.System.canWrite(ctx)) return false
    val cr = ctx.contentResolver
    return try {
      if (percent < 0) {
        Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC)
      } else {
        Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
        Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS, (percent.coerceIn(1, 100) * 255 + 50) / 100)
      }
      true
    } catch (e: Exception) {
      false
    }
  }

  /** wifi | internet (mobile data) | bluetooth | airplane | nfc | volume: the system panel or page. */
  fun openPanel(ctx: Context, activity: Activity?, kind: String): Boolean {
    val q = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
    val action = when (kind) {
      "wifi" -> if (q) Settings.Panel.ACTION_WIFI else Settings.ACTION_WIFI_SETTINGS
      "internet" -> if (q) Settings.Panel.ACTION_INTERNET_CONNECTIVITY else Settings.ACTION_DATA_ROAMING_SETTINGS
      "nfc" -> if (q) Settings.Panel.ACTION_NFC else Settings.ACTION_NFC_SETTINGS
      "volume" -> if (q) Settings.Panel.ACTION_VOLUME else Settings.ACTION_SOUND_SETTINGS
      "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
      "airplane" -> Settings.ACTION_AIRPLANE_MODE_SETTINGS
      else -> Settings.ACTION_SETTINGS
    }
    return start(ctx, activity, Intent(action)) || start(ctx, activity, Intent(Settings.ACTION_SETTINGS))
  }

  /** "Play X on Spotify": the standard play-from-search hand-off; pkg empty = the default player. */
  fun playFromSearch(ctx: Context, activity: Activity?, query: String, pkg: String): Boolean {
    val i = Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH)
      .putExtra(SearchManager.QUERY, query)
      .putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*")
    if (pkg.isNotEmpty()) i.setPackage(pkg)
    if (start(ctx, activity, i)) return true
    // Apps without play-from-search (YouTube): their search screen.
    if (pkg.isNotEmpty()) {
      val s = Intent(Intent.ACTION_SEARCH).setPackage(pkg).putExtra(SearchManager.QUERY, query).putExtra("query", query)
      if (start(ctx, activity, s)) return true
    }
    return false
  }

  fun isLocked(ctx: Context): Boolean =
    (ctx.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked

  /** Asks the user to unlock (PIN / fingerprint) over the lock screen; true once unlocked. */
  fun requestUnlock(activity: Activity?, done: (Boolean) -> Unit) {
    val a = activity ?: return done(false)
    val km = a.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    if (!km.isKeyguardLocked) return done(true)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return done(false)
    km.requestDismissKeyguard(
      a,
      object : KeyguardManager.KeyguardDismissCallback() {
        override fun onDismissSucceeded() = done(true)
        override fun onDismissCancelled() = done(false)
        override fun onDismissError() = done(false)
      },
    )
  }
}
