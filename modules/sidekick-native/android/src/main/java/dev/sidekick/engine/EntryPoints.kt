package dev.sidekick.engine

import android.app.StatusBarManager
import android.app.role.RoleManager
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.provider.Settings

/** Settings helpers for the assistant role, Quick Settings tile and widget. */
object EntryPoints {
  fun isDefaultAssistant(context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= 29) {
      val roles = context.getSystemService(RoleManager::class.java)
      if (roles != null && roles.isRoleAvailable(RoleManager.ROLE_ASSISTANT)) {
        return roles.isRoleHeld(RoleManager.ROLE_ASSISTANT)
      }
    }
    val current = Settings.Secure.getString(context.contentResolver, "assistant") ?: return false
    return ComponentName.unflattenFromString(current)?.packageName == context.packageName
  }

  /** Opens the system "Digital assistant app" page (falls back to Default apps). */
  fun openAssistantSettings(context: Context): Boolean {
    val actions = listOf(Settings.ACTION_VOICE_INPUT_SETTINGS, Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS, Settings.ACTION_SETTINGS)
    for (action in actions) {
      try {
        context.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
      } catch (e: Exception) {
        android.util.Log.w("SidekickEntry", "no settings page for $action", e)
      }
    }
    return false
  }

  /** Asks the system to add the Ask tile (Android 13+); false if not supported. */
  fun requestAddTile(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 33) return false
    val sb = context.getSystemService(StatusBarManager::class.java) ?: return false
    sb.requestAddTileService(
      ComponentName(context, AskTileService::class.java),
      context.getString(R.string.sidekick_tile_label),
      Icon.createWithResource(context, R.drawable.sidekick_tile),
      context.mainExecutor,
    ) {}
    return true
  }

  /** Asks the launcher to pin the widget; false if the launcher can't. */
  fun requestAddWidget(context: Context): Boolean {
    val mgr = AppWidgetManager.getInstance(context)
    if (Build.VERSION.SDK_INT < 26 || !mgr.isRequestPinAppWidgetSupported) return false
    return mgr.requestPinAppWidget(ComponentName(context, AskWidgetProvider::class.java), null, null)
  }
}
