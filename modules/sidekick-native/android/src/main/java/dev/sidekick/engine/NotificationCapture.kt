package dev.sidekick.engine

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.io.File

/**
 * Data source "notifications" (Android only, off by default). The system binds the listener
 * only after the user allows it in Settings > Notification access; even then nothing is kept
 * unless the in-app switch is on. Entries go to an app-private file that JS drains into the
 * encrypted database (like the listening journal).
 */
object NotificationCapture {
  private const val PREFS = "sidekick"
  private const val KEY_CAPTURE = "notifications.capture"
  private const val MAX_FILE_BYTES = 2_000_000L

  private fun file(ctx: Context) = File(ctx.filesDir, "data/notifications.jsonl").apply { parentFile?.mkdirs() }

  fun accessGranted(ctx: Context): Boolean =
    NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName)

  fun openAccessSettings(ctx: Context) {
    val component = ComponentName(ctx, SidekickNotificationListener::class.java)
    val intent =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
          .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component.flattenToString())
      } else {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
      }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      ctx.startActivity(intent)
    } catch (e: Exception) {
      ctx.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  fun setCapture(ctx: Context, enabled: Boolean) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_CAPTURE, enabled).apply()
    if (!enabled) synchronized(this) { file(ctx).delete() }
  }

  fun capturing(ctx: Context): Boolean =
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_CAPTURE, false)

  @Synchronized
  fun append(ctx: Context, entry: JSONObject) {
    val f = file(ctx)
    // The app hasn't been opened for a long time: stop growing rather than fill the disk.
    if (f.length() > MAX_FILE_BYTES) return
    f.appendText(entry.toString() + "\n")
  }

  @Synchronized
  fun drain(ctx: Context): List<String> {
    val f = file(ctx)
    if (!f.exists()) return emptyList()
    val lines = f.readLines().filter { it.isNotBlank() }
    f.delete()
    return lines
  }
}

class SidekickNotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    sbn ?: return
    val ctx = applicationContext
    if (!NotificationCapture.capturing(ctx)) return
    if (sbn.packageName == ctx.packageName || sbn.isOngoing) return
    val n = sbn.notification ?: return
    if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    val extras = n.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
    val text =
      (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))
        ?.toString()
    if (title.isNullOrBlank() && text.isNullOrBlank()) return
    val app =
      try {
        val pm = ctx.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(sbn.packageName, 0)).toString()
      } catch (e: Exception) {
        null
      }
    val entry =
      JSONObject()
        .put("at", sbn.postTime)
        .put("pkg", sbn.packageName)
        .put("app", app)
        .put("title", title)
        .put("text", text)
        .put("category", n.category)
    NotificationCapture.append(ctx, entry)
  }
}
