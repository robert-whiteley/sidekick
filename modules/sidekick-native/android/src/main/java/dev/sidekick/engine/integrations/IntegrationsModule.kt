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
