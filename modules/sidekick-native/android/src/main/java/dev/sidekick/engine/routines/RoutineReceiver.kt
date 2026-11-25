package dev.sidekick.engine.routines

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

/** The routine alarm, and re-arming it after a reboot or an app update. */
class RoutineReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    when (intent.action) {
      Routines.ACTION_ALARM -> {
        Routines.start(ctx, JSONObject().put("type", "time").put("at", System.currentTimeMillis()))
        // The next one; JS also re-plans after it runs.
        Routines.arm(ctx)
      }
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" -> Routines.arm(ctx)
    }
  }
}
