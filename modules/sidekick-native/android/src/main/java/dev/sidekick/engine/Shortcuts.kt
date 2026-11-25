package dev.sidekick.engine

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat

/**
 * Long-press app icon shortcuts (dynamic, set at start-up): Ask, Listen, Camera, Remember this.
 * Each opens `sidekick://?entry=<kind>` like the widget (see src/engine/entry-points.ts).
 */
object Shortcuts {
  private data class Item(val id: String, val short: String, val long: String, val entry: String, val icon: Int)

  private val items =
    listOf(
      Item("ask", "Ask", "Ask Sidekick", EntryLinks.LISTEN, R.drawable.sidekick_sc_ask),
      Item("listen", "Listen", "Listen in the background", "listenmode", R.drawable.sidekick_sc_listen),
      Item("camera", "Camera", "Live camera", "camera", R.drawable.sidekick_sc_camera),
      Item("remember", "Remember this", "Take a photo to remember", EntryLinks.CAPTURE, R.drawable.sidekick_sc_remember),
    )

  fun publish(context: Context): Boolean {
    return try {
      val list =
        items.map { i ->
          ShortcutInfoCompat.Builder(context, i.id)
            .setShortLabel(i.short)
            .setLongLabel(i.long)
            .setIcon(IconCompat.createWithResource(context, i.icon))
            .setIntent(
              Intent(Intent.ACTION_VIEW, Uri.parse("sidekick://?entry=${i.entry}"))
                .setPackage(context.packageName)
            )
            .build()
        }
      val max = ShortcutManagerCompat.getMaxShortcutCountPerActivity(context)
      ShortcutManagerCompat.setDynamicShortcuts(context, list.take(maxOf(1, max)))
    } catch (e: Exception) {
      Log.w("SidekickShortcuts", "couldn't set shortcuts", e)
      false
    }
  }
}
