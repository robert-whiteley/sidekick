package dev.sidekick.engine.routines

import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Runs the JS task "SidekickRoutine" (src/engine/routines-task.ts) with or without the app on
 * screen. A short foreground service (Android 14+: shortService, up to ~3 minutes) so Android
 * doesn't stop it while the model answers.
 */
class RoutineTaskService : HeadlessJsTaskService() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    Routines.ensureChannel(this)
    val n =
      NotificationCompat.Builder(this, Routines.channel())
        .setSmallIcon(android.R.drawable.ic_popup_reminder)
        .setContentTitle("Running a routine")
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setSilent(true)
        .build()
    try {
      val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE else 0
      ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type)
    } catch (e: Exception) {
      Log.w("SidekickRoutines", "foreground start failed", e)
    }
    return super.onStartCommand(intent, flags, startId)
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val payload = intent?.getStringExtra("payload") ?: return null
    val data = Arguments.createMap().apply { putString("payload", payload) }
    return HeadlessJsTaskConfig("SidekickRoutine", data, TIMEOUT_MS, true)
  }

  /** Android 14+: the short service's time is up. */
  override fun onTimeout(startId: Int) {
    stopSelf()
  }

  companion object {
    private const val NOTIFICATION_ID = 4712
    private const val TIMEOUT_MS = 170_000L
  }
}
