package dev.sidekick.engine

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews

/** Home-screen widget: Ask (opens ready to listen) and Capture (opens and takes a photo). */
class AskWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val views = RemoteViews(context.packageName, R.layout.sidekick_widget).apply {
      setOnClickPendingIntent(R.id.sidekick_widget_ask, EntryLinks.pendingIntent(context, EntryLinks.LISTEN, 1))
      setOnClickPendingIntent(R.id.sidekick_widget_capture, EntryLinks.pendingIntent(context, EntryLinks.CAPTURE, 2))
    }
    manager.updateAppWidget(ids, views)
  }
}
