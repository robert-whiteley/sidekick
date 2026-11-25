package dev.sidekick.engine.usb

import android.content.Context
import android.content.Intent
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.view.KeyEvent

/**
 * Headphone / Bluetooth button → ask. While on (walk mode, or Listen with headphones), Sidekick
 * holds an active media session so a single press of the headset button reaches it; emits
 * "onMediaButton" {action: 'ask' | 'next' | 'previous'} and JS decides (ask, or stop a playing
 * answer). Long-press reaches Sidekick through the system assistant path when it is the default
 * assistant app (no session needed).
 *
 * Android sends media buttons to the app that most recently played audio with an active session,
 * so a music app played afterwards takes the button back until Sidekick speaks again.
 */
object MediaButtons {
  @Volatile var listener: ((String, Map<String, Any?>) -> Unit)? = null

  private var session: MediaSession? = null

  @Synchronized
  fun enable(ctx: Context, on: Boolean) {
    if (!on) {
      session?.run {
        isActive = false
        release()
      }
      session = null
      return
    }
    if (session != null) return
    val s = MediaSession(ctx.applicationContext, "Sidekick")
    s.setCallback(
      object : MediaSession.Callback() {
        override fun onMediaButtonEvent(intent: Intent): Boolean {
          val ev =
            if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
            else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT)
          if (ev == null || ev.action != KeyEvent.ACTION_UP || ev.isCanceled) return true
          val action = actionFor(ev.keyCode) ?: return false
          listener?.invoke("onMediaButton", mapOf("action" to action))
          return true
        }
      },
    )
    s.setPlaybackState(
      PlaybackState.Builder()
        .setActions(PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
          PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS)
        .setState(PlaybackState.STATE_PLAYING, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
        .build(),
    )
    s.isActive = true
    session = s
  }

  fun actionFor(keyCode: Int): String? =
    when (keyCode) {
      KeyEvent.KEYCODE_HEADSETHOOK, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY,
      KeyEvent.KEYCODE_MEDIA_PAUSE -> "ask"
      KeyEvent.KEYCODE_MEDIA_NEXT -> "next"
      KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "previous"
      else -> null
    }

  val enabled: Boolean get() = session != null
}
