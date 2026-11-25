package dev.sidekick.engine.integrations

import android.app.Notification
import android.app.RemoteInput
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import dev.sidekick.engine.NotificationCapture
import dev.sidekick.engine.SidekickNotificationListener
import org.json.JSONArray
import org.json.JSONObject

/**
 * Live view of the phone's notifications and media sessions through Sidekick's notification
 * listener (the same access as the "notifications" memory source). Nothing is stored here: it
 * reads what is on screen right now when the user asks. Text from other apps is untrusted.
 */
object NotificationHub {
  @Volatile var listener: NotificationListenerService? = null

  private val MESSENGERS = setOf(
    "com.whatsapp", "com.whatsapp.w4b", "org.telegram.messenger", "org.telegram.messenger.web",
    "org.thoughtcrime.securesms", "com.google.android.apps.messaging", "com.samsung.android.messaging",
    "com.android.mms", "com.facebook.orca", "com.discord", "com.Slack", "com.microsoft.teams",
  )

  fun accessGranted(ctx: Context) = NotificationCapture.accessGranted(ctx)

  private fun active(): Array<StatusBarNotification> =
    try {
      listener?.activeNotifications ?: emptyArray()
    } catch (e: Exception) {
      emptyArray()
    }

  private fun label(ctx: Context, pkg: String): String =
    try {
      val pm = ctx.packageManager
      pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (e: Exception) {
      pkg
    }

  /** The free-text reply action of a notification, if it has one. */
  fun replyAction(n: Notification): Notification.Action? =
    n.actions?.firstOrNull { a ->
      a.remoteInputs?.any { it.allowFreeFormInput } == true &&
        (a.semanticAction == Notification.Action.SEMANTIC_ACTION_REPLY || a.semanticAction == Notification.Action.SEMANTIC_ACTION_NONE)
    }

  fun threads(ctx: Context, onlyMessages: Boolean): String {
    val out = JSONArray()
    for (sbn in active()) {
      if (sbn.packageName == ctx.packageName || sbn.isOngoing) continue
      val n = sbn.notification ?: continue
      if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) continue
      val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n)
      val isMessage = style != null || n.category == Notification.CATEGORY_MESSAGE || sbn.packageName in MESSENGERS
      if (onlyMessages && !isMessage) continue
      val extras = n.extras ?: Bundle()
      val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
      var sender = title
      var text =
        (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString() ?: ""
      var conversation = extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString() ?: title
      if (style != null && style.messages.isNotEmpty()) {
        val last = style.messages.last()
        sender = last.person?.name?.toString() ?: title
        // The last few lines of the chat, oldest first.
        text = style.messages.takeLast(3).joinToString(" / ") { it.text?.toString() ?: "" }
        conversation = style.conversationTitle?.toString() ?: sender
      }
      if (text.isBlank()) continue
      out.put(
        JSONObject()
          .put("key", sbn.key)
          .put("pkg", sbn.packageName)
          .put("app", label(ctx, sbn.packageName))
          .put("conversation", conversation)
          .put("sender", sender)
          .put("text", text.take(1000))
          .put("at", sbn.postTime)
          .put("canReply", replyAction(n) != null),
      )
    }
    return out.toString()
  }

  /** Sends [text] through the notification's own reply action (as if typed in the shade). */
  fun reply(ctx: Context, key: String, text: String): Boolean {
    val sbn = active().firstOrNull { it.key == key } ?: return false
    val action = replyAction(sbn.notification) ?: return false
    val inputs = action.remoteInputs ?: return false
    val results = Bundle()
    for (ri in inputs) results.putCharSequence(ri.resultKey, text)
    val intent = Intent()
    RemoteInput.addResultsToIntent(inputs, intent, results)
    return try {
      action.actionIntent.send(ctx, 0, intent)
      true
    } catch (e: Exception) {
      false
    }
  }

  private fun controllers(ctx: Context): List<MediaController> =
    try {
      val msm = ctx.getSystemService(MediaSessionManager::class.java)
      msm.getActiveSessions(ComponentName(ctx, SidekickNotificationListener::class.java))
    } catch (e: SecurityException) {
      emptyList()
    }

  private fun current(ctx: Context): MediaController? {
    val all = controllers(ctx)
    return all.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING } ?: all.firstOrNull()
  }

  fun nowPlaying(ctx: Context): String? {
    val c = current(ctx) ?: return null
    val md = c.metadata
    return JSONObject()
      .put("app", label(ctx, c.packageName))
      .put("title", md?.getString(MediaMetadata.METADATA_KEY_TITLE))
      .put("artist", md?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: md?.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST))
      .put("playing", c.playbackState?.state == PlaybackState.STATE_PLAYING)
      .toString()
  }

  fun media(ctx: Context, cmd: String): Boolean {
    val c = current(ctx) ?: return false
    val t = c.transportControls
    when (cmd) {
      "play" -> t.play()
      "pause" -> t.pause()
      "stop" -> t.stop()
      "next" -> t.skipToNext()
      "previous" -> t.skipToPrevious()
      "toggle" -> if (c.playbackState?.state == PlaybackState.STATE_PLAYING) t.pause() else t.play()
      else -> return false
    }
    return true
  }
}
