package dev.sidekick.engine

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Links from the assistant gesture, Quick Settings tile and home-screen widget into the app.
 * Expo Router hands `?entry=` to the home screen (see src/engine/entry-points.ts).
 */
object EntryLinks {
  const val LISTEN = "listen"
  const val CAPTURE = "capture"
  const val SCREEN = "screen"

  fun intent(context: Context, entry: String): Intent =
    Intent(Intent.ACTION_VIEW, Uri.parse("sidekick://?entry=$entry&t=${System.currentTimeMillis()}"))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

  /** Widget buttons: a fixed link (the app clears `entry` once handled, so repeat taps still work). */
  fun pendingIntent(context: Context, entry: String, requestCode: Int): PendingIntent {
    val i = Intent(Intent.ACTION_VIEW, Uri.parse("sidekick://?entry=$entry"))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      requestCode,
      i,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }
}
