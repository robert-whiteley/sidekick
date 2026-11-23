package dev.sidekick.engine

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/** Quick Settings tile: opens Sidekick ready to listen (push-to-talk ask). */
class AskTileService : TileService() {
  override fun onStartListening() {
    qsTile?.apply {
      state = Tile.STATE_INACTIVE
      updateTile()
    }
  }

  override fun onClick() {
    val intent = EntryLinks.intent(this, EntryLinks.LISTEN)
    if (isLocked) unlockAndRun { open(intent) } else open(intent)
  }

  @SuppressLint("StartActivityAndCollapseDeprecated")
  private fun open(intent: Intent) {
    if (Build.VERSION.SDK_INT >= 34) {
      startActivityAndCollapse(
        PendingIntent.getActivity(
          this,
          0,
          intent,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        ),
      )
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }
}
