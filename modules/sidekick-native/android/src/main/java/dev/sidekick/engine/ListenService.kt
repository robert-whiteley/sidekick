package dev.sidekick.engine

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Keeps the microphone open with the screen off: wake word, ambient transcripts, and spoken
 * answers when the app isn't on screen. Android shows a permanent notification while it runs.
 */
class ListenService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ListenPrefs.load(this)
    MicLoop.nativeAnswerer = ::answer
    MicLoop.onPauseChange = { reason ->
      getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, notification(reason))
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopListening(this)
      return START_NOT_STICKY
    }
    // Location type only with permission: declaring it without permission crashes the service.
    val withLocation = Places.hasPermission(this)
    val type =
      if (Build.VERSION.SDK_INT < 30) 0
      else if (withLocation)
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
      else ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(MicLoop.pauseReason), type)
    if (withLocation) Places.startTracking(this)
    MicLoop.startAmbient(this)
    return START_STICKY
  }

  override fun onDestroy() {
    MicLoop.stopAmbient()
    MicLoop.nativeAnswerer = null
    MicLoop.onPauseChange = null
    Places.stopTracking(this)
    super.onDestroy()
  }

  /**
   * Background answer: the app isn't on screen, so the service asks the model and speaks it
   * sentence by sentence. A follow-up (said right after an answer, or over it) keeps the chat.
   */
  private fun answer(question: String, followUp: Boolean) {
    val llm = Engines.llm(this)
    if (!llm.ensureLoadedFromLastRun(this)) {
      speak("Open Sidekick once so I can load my model.")
      return
    }
    val prefs = getSharedPreferences("sidekick", Context.MODE_PRIVATE)
    val system = prefs.getString("assistant.system", null)
    val sb = StringBuilder()
    val turn = Voice.begin()
    val sentences = SentenceSplitter()
    llm.generate(
      question,
      null,
      GenerateOptions(maxTokens = 160, keepHistory = followUp, system = system),
      onText = {
        sb.append(it)
        sentences.push(it).forEach { s -> Voice.say(this, s, turn) }
      },
      onFinish = {
        val answer = sb.toString().trim()
        Journal.append(
          this,
          Places.tag(
            org.json.JSONObject()
              .put("kind", "answer")
              .put("at", System.currentTimeMillis())
              .put("text", answer)
              .put("question", question)
          ),
        )
        Voice.say(this, sentences.finish(), turn)
        Voice.end(turn)
      },
      onFail = {
        Log.w(TAG, "answer failed", it)
        // Stopped by the user talking over it: say nothing.
        if (Voice.begin() == turn) speak("Sorry, I couldn't answer that.")
      },
    )
  }

  private fun speak(text: String) {
    val turn = Voice.begin()
    Voice.say(this, text, turn)
    Voice.end(turn)
  }

  private fun notification(pauseReason: String?): Notification {
    val nm = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL, "Listening", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while Sidekick is listening"
        }
      )
    }
    val open =
      PendingIntent.getActivity(
        this,
        0,
        packageManager.getLaunchIntentForPackage(packageName),
        PendingIntent.FLAG_IMMUTABLE,
      )
    val stop =
      PendingIntent.getService(
        this,
        1,
        Intent(this, ListenService::class.java).setAction(ACTION_STOP),
        PendingIntent.FLAG_IMMUTABLE,
      )
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentTitle(if (pauseReason == null) "Sidekick is listening" else "Sidekick is paused ($pauseReason)")
      .setContentText(
        if (pauseReason == null) "Say \"${MicLoop.wakePhrase}\". Everything stays on this phone."
        else "Not listening or keeping anything until this ends. Hold the mic button to ask."
      )
      .setOngoing(true)
      .setContentIntent(open)
      .addAction(0, "Stop", stop)
      .build()
  }

  companion object {
    private const val TAG = "SidekickListen"
    private const val CHANNEL = "listen"
    private const val NOTIFICATION_ID = 42
    private const val ACTION_STOP = "dev.sidekick.STOP_LISTENING"
    @Volatile var active = false
      private set

    /** Must be called while the app is visible (Android forbids starting the mic from background). */
    fun startListening(ctx: Context) {
      active = true
      ctx.startForegroundService(Intent(ctx, ListenService::class.java))
    }

    fun stopListening(ctx: Context) {
      active = false
      MicLoop.stopAmbient()
      ctx.stopService(Intent(ctx, ListenService::class.java))
    }
  }
}
