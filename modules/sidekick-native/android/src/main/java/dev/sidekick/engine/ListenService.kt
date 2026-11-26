package dev.sidekick.engine

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.KeyguardManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import dev.sidekick.engine.camera.LiveCapture
import dev.sidekick.engine.camera.ServiceNotice

/**
 * Keeps the microphone open with the screen off: wake word, ambient transcripts, and spoken
 * answers when the app isn't on screen. Android shows a permanent notification while it runs.
 */
class ListenService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  /** True once startForeground succeeded (an update that Android refuses keeps the old state). */
  private var inForeground = false
  /** The foreground types Android last accepted (mic / camera / location only work with theirs). */
  private var grantedType = 0

  /** Screen off / unlocked: the camera pauses while locked only if the user turned that off. */
  private val screen =
    object : BroadcastReceiver() {
      override fun onReceive(c: Context, i: Intent) {
        when (i.action) {
          Intent.ACTION_SCREEN_OFF -> LiveCapture.onScreen(off = true)
          Intent.ACTION_USER_PRESENT -> LiveCapture.onScreen(off = false)
          Intent.ACTION_SCREEN_ON ->
            if (c.getSystemService(KeyguardManager::class.java)?.isKeyguardLocked != true) LiveCapture.onScreen(off = false)
        }
        refreshNotification()
      }
    }

  override fun onCreate() {
    super.onCreate()
    instance = this
    registerReceiver(
      screen,
      IntentFilter().apply {
        addAction(Intent.ACTION_SCREEN_OFF)
        addAction(Intent.ACTION_SCREEN_ON)
        addAction(Intent.ACTION_USER_PRESENT)
      },
    )
    ListenPrefs.load(this)
    MicLoop.nativeAnswerer = ::answer
    MicLoop.onPauseChange = { reason ->
      getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, notification(reason))
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        cameraOn = false
        rememberCamera(this, false)
        LiveCapture.stop()
        stopListening(this)
        return START_NOT_STICKY
      }
      ACTION_PAUSE_CAMERA -> {
        LiveCapture.setUserPaused(true)
        refreshNotification()
        return START_STICKY
      }
      ACTION_RESUME_CAMERA -> {
        LiveCapture.setUserPaused(false)
        refreshNotification()
        return START_STICKY
      }
      ACTION_STOP_CAMERA -> {
        stopCamera(this)
        return if (active) START_STICKY else START_NOT_STICKY
      }
    }
    // Restarted by Android after the app was killed: the camera can't restart from the
    // background (it says so with a "tap to turn it back on" notification), the mic only if
    // it was listening before.
    if (intent == null) {
      if (cameraOn || cameraWanted(this)) resumePrompt(camera = true)
      cameraOn = false
      active = getSharedPreferences("sidekick", Context.MODE_PRIVATE).getBoolean(PREF_ACTIVE, true)
    }
    if (!active && !cameraOn) {
      stopSelf()
      return START_NOT_STICKY
    }
    // Location type only with permission: declaring it without permission crashes the service.
    // Camera type only while the camera is on and allowed (same reason). A restart by Android
    // (intent == null) happens in the background, where while-in-use location isn't available
    // (Android 14+ throws), so it restarts without location tagging.
    val withLocation = Places.hasPermission(this) && intent != null
    val withCamera =
      cameraOn && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    var type = 0
    if (Build.VERSION.SDK_INT >= 30) {
      if (active) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      if (withLocation) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
      if (withCamera) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
      if (type == 0) type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    }
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(MicLoop.pauseReason), type)
      inForeground = true
      grantedType = type
    } catch (e: Exception) {
      // Android 14+: while-in-use types (mic, camera, location) can't start from the background.
      Log.w("SidekickListen", "can't start in the foreground now", e)
      if (!inForeground) {
        if (active || cameraOn) resumePrompt(camera = cameraOn)
        stopSelf()
        return START_NOT_STICKY
      }
      // Already running in the foreground (e.g. "stop the camera" said with the phone locked):
      // keep the earlier types, still apply what was switched off, and update the notification.
      refreshNotification()
    }
    val has = { t: Int -> Build.VERSION.SDK_INT < 30 || grantedType and t != 0 }
    if (withLocation && has(ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)) Places.startTracking(this)
    if (active && has(ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)) MicLoop.startAmbient(this) else MicLoop.stopAmbient()
    if (withCamera && has(ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)) LiveCapture.start(this)
    else {
      if (withCamera) {
        // Asked for from the background (e.g. by voice with the phone locked): Android refuses.
        cameraOn = false
        resumePrompt(camera = true)
      }
      LiveCapture.stop()
    }
    return START_STICKY
  }

  override fun onDestroy() {
    instance = null
    inForeground = false
    runCatching { unregisterReceiver(screen) }
    LiveCapture.stop()
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
        NotificationChannel(CHANNEL, ServiceNotice.CHANNEL_NAME, ServiceNotice.CHANNEL_IMPORTANCE).apply {
          description = "Shown while Sidekick is listening or filming, with Pause and Stop (also on the lock screen)"
          if (!ServiceNotice.CHANNEL_SOUND) setSound(null, null)
          enableVibration(ServiceNotice.CHANNEL_VIBRATE)
          lockscreenVisibility = Notification.VISIBILITY_PUBLIC
          setShowBadge(false)
        }
      )
      nm.deleteNotificationChannel(ServiceNotice.OLD_CHANNEL)
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
    val n =
      ServiceNotice.text(
        listening = active,
        cameraOn = cameraOn,
        cameraPaused = LiveCapture.userPaused,
        lockPaused = LiveCapture.lockPaused,
        micPauseReason = pauseReason,
        wakePhrase = MicLoop.wakePhrase,
      )
    val b =
      NotificationCompat.Builder(this, CHANNEL)
        // Camera only: no mic icon, so the status bar doesn't suggest the mic is on.
        .setSmallIcon(if (cameraOn && !active) android.R.drawable.ic_menu_camera else android.R.drawable.ic_btn_speak_now)
        .setContentTitle(n.title)
        .setContentText(n.body)
        .setOngoing(true)
        // Updates (pause, resume, heat) never alert again.
        .setOnlyAlertOnce(true)
        .setContentIntent(open)
        // Shown in full on the lock screen: it only says what is on, never what was heard.
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
    n.actions.forEach { a ->
      when (a) {
        "pauseCamera" -> b.addAction(0, "Pause camera", serviceAction(ACTION_PAUSE_CAMERA, 2))
        "resumeCamera" -> b.addAction(0, "Resume camera", serviceAction(ACTION_RESUME_CAMERA, 3))
        "stopCamera" -> b.addAction(0, "Stop camera", serviceAction(ACTION_STOP_CAMERA, 4))
        "stop" -> b.addAction(0, "Stop", stop)
      }
    }
    return b.build()
  }

  private fun serviceAction(action: String, code: Int): PendingIntent =
    PendingIntent.getService(this, code, Intent(this, ListenService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE)

  /** Re-posts the ongoing notification with the current state. */
  fun refreshNotification() {
    if (!inForeground) return
    getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, notification(MicLoop.pauseReason))
  }

  /**
   * Android refused to (re)start the camera or mic from the background: a tap on this reopens
   * Sidekick, which turns it back on (entry "camera" / "listenmode").
   */
  private fun resumePrompt(camera: Boolean) {
    val nm = getSystemService(NotificationManager::class.java) ?: return
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(RESUME_CHANNEL) == null) {
      nm.createNotificationChannel(
        NotificationChannel(RESUME_CHANNEL, "Turn back on", NotificationManager.IMPORTANCE_DEFAULT).apply {
          description = "When Android stopped the camera or listening"
        }
      )
    }
    val entry = if (camera) "camera" else "listenmode"
    val tap =
      PendingIntent.getActivity(
        this,
        10,
        Intent(Intent.ACTION_VIEW, android.net.Uri.parse("sidekick://?entry=$entry")).setPackage(packageName)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_IMMUTABLE,
      )
    nm.notify(
      RESUME_ID,
      NotificationCompat.Builder(this, RESUME_CHANNEL)
        .setSmallIcon(if (camera) android.R.drawable.ic_menu_camera else android.R.drawable.ic_btn_speak_now)
        .setContentTitle(if (camera) "Sidekick's camera was stopped by Android" else "Sidekick stopped listening")
        .setContentText("Tap to turn it back on.")
        .setContentIntent(tap)
        .setAutoCancel(true)
        .build(),
    )
  }

  companion object {
    private const val TAG = "SidekickListen"
    private const val CHANNEL = ServiceNotice.CHANNEL
    private const val NOTIFICATION_ID = 42
    private const val ACTION_STOP = "dev.sidekick.STOP_LISTENING"
    private const val ACTION_PAUSE_CAMERA = "dev.sidekick.PAUSE_CAMERA"
    private const val ACTION_RESUME_CAMERA = "dev.sidekick.RESUME_CAMERA"
    private const val ACTION_STOP_CAMERA = "dev.sidekick.STOP_CAMERA"
    private const val RESUME_CHANNEL = "resume"
    private const val RESUME_ID = 43
    private const val PREF_CAMERA = "camera.wanted"
    /** The running service, to update it without a background start (Android 12+ refuses those). */
    @Volatile private var instance: ListenService? = null
    private const val PREF_ACTIVE = "listen.active"
    @Volatile var active = false
      private set
    /** Live camera memory (LiveCapture) runs in this same service while on. */
    @Volatile var cameraOn = false
      private set

    /** Must be called while the app is visible (Android forbids starting the mic from background). */
    fun startListening(ctx: Context) {
      active = true
      remember(ctx, true)
      if (instance != null) update(ctx) else ctx.startForegroundService(Intent(ctx, ListenService::class.java))
    }

    fun stopListening(ctx: Context) {
      active = false
      remember(ctx, false)
      MicLoop.stopAmbient()
      if (cameraOn) update(ctx) else ctx.stopService(Intent(ctx, ListenService::class.java))
    }

    /** Re-applies the state to the running service directly (works with the app in the background). */
    private fun update(ctx: Context) {
      val s = instance
      if (s != null) s.onStartCommand(Intent(ctx, ListenService::class.java), 0, 0)
      else runCatching { ctx.startForegroundService(Intent(ctx, ListenService::class.java)) }
    }

    /** From the app or a voice command: pause / resume filming without stopping the service. */
    fun setCameraPaused(p: Boolean) {
      LiveCapture.setUserPaused(p)
      instance?.refreshNotification()
    }

    /** Must be called while the app is visible (camera use can't start from the background). */
    fun startCamera(ctx: Context) {
      cameraOn = true
      rememberCamera(ctx, true)
      LiveCapture.setUserPaused(false)
      ctx.getSystemService(NotificationManager::class.java)?.cancel(RESUME_ID)
      if (instance != null) update(ctx) else ctx.startForegroundService(Intent(ctx, ListenService::class.java))
    }

    fun stopCamera(ctx: Context) {
      cameraOn = false
      rememberCamera(ctx, false)
      LiveCapture.stop()
      if (active) update(ctx) else ctx.stopService(Intent(ctx, ListenService::class.java))
    }

    private fun cameraWanted(ctx: Context) =
      ctx.getSharedPreferences("sidekick", Context.MODE_PRIVATE).getBoolean(PREF_CAMERA, false)

    private fun rememberCamera(ctx: Context, on: Boolean) =
      ctx.getSharedPreferences("sidekick", Context.MODE_PRIVATE).edit().putBoolean(PREF_CAMERA, on).apply()

    fun wanted(ctx: Context): Boolean =
      ctx.getSharedPreferences("sidekick", Context.MODE_PRIVATE).getBoolean(PREF_ACTIVE, false)

    private fun remember(ctx: Context, on: Boolean) =
      ctx.getSharedPreferences("sidekick", Context.MODE_PRIVATE).edit().putBoolean(PREF_ACTIVE, on).apply()
  }
}
