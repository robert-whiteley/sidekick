package dev.sidekick.engine.integrations

import android.app.NotificationManager
import android.content.Context
import dev.sidekick.engine.NotificationCapture
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS: src/integrations/native.ts. */
class IntegrationsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No React context")

  private val activity get() = appContext.currentActivity

  override fun definition() = ModuleDefinition {
    Name("SidekickIntegrations")

    Function("isInstalled") { pkg: String -> Intents.isInstalled(context, pkg) }
    Function("setAlarm") { hour: Int, minute: Int, label: String -> Intents.setAlarm(context, activity, hour, minute, label) }
    Function("setTimer") { seconds: Int, label: String -> Intents.setTimer(context, activity, seconds, label) }
    Function("call") { number: String, direct: Boolean -> Intents.call(context, activity, number, direct) }
    Function("navigate") { destination: String, mode: String -> Intents.navigate(context, activity, destination, mode) }
    Function("openMessage") { app: String, number: String?, text: String ->
      Intents.openMessage(context, activity, app, number, text)
    }

    // Phone controls (PhoneControls.kt).
    Function("launchableApps") { PhoneControls.launchableApps(context) }
    Function("openApp") { pkg: String -> PhoneControls.openApp(context, activity, pkg) }
    // 1 = on, 0 = off, -1 = no torch (on: 1 on, 0 off, -1 toggle).
    Function("flashlight") { on: Int ->
      when (PhoneControls.flashlight(context, if (on < 0) null else on == 1)) { true -> 1; false -> 0; null -> -1 }
    }
    Function("volume") { dir: String, percent: Int -> PhoneControls.volume(context, dir, percent) }
    Function("dndAccess") { PhoneControls.dndAccess(context) }
    Function("openDndAccess") { PhoneControls.openDndAccess(context, activity) }
    Function("setDnd") { on: Boolean -> PhoneControls.setDnd(context, on) }
    Function("canWriteSettings") { PhoneControls.canWriteSettings(context) }
    Function("openWriteSettings") { PhoneControls.openWriteSettings(context, activity) }
    Function("brightness") { PhoneControls.brightness(context) }
    Function("setBrightness") { percent: Int -> PhoneControls.setBrightness(context, percent) }
    Function("openPanel") { kind: String -> PhoneControls.openPanel(context, activity, kind) }
    Function("playFromSearch") { query: String, pkg: String -> PhoneControls.playFromSearch(context, activity, query, pkg) }
    Function("isLocked") { PhoneControls.isLocked(context) }
    AsyncFunction("requestUnlock") { promise: Promise ->
      PhoneControls.requestUnlock(activity) { promise.resolve(it) }
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)

    Function("notificationAccess") { NotificationCapture.accessGranted(context) }
    Function("openNotificationAccess") { NotificationCapture.openAccessSettings(context) }
    Function("messageThreads") { onlyMessages: Boolean -> NotificationHub.threads(context, onlyMessages) }
    Function("replyToMessage") { key: String, text: String -> NotificationHub.reply(context, key, text) }
    Function("nowPlaying") { NotificationHub.nowPlaying(context) }
    Function("mediaCommand") { cmd: String -> NotificationHub.media(context, cmd) }
    // Do Not Disturb: 1 = all allowed, 2 priority only, 3 none, 4 alarms only (0 = unknown).
    Function("interruptionFilter") {
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).currentInterruptionFilter
    }

    AsyncFunction("googleAuthorize") { scopes: List<String>, promise: Promise ->
      val a = activity ?: return@AsyncFunction promise.reject("E_NO_ACTIVITY", "Open Sidekick first", null)
      GoogleAuth.authorize(a, scopes, promise)
    }
    AsyncFunction("googleClearToken") { token: String, promise: Promise ->
      val a = activity ?: return@AsyncFunction promise.resolve(null)
      GoogleAuth.clearToken(a, token, promise)
    }

    OnActivityResult { act, payload -> GoogleAuth.onActivityResult(act, payload.requestCode, payload.data) }
  }
}
