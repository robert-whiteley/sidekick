package dev.sidekick.engine.offline

import android.content.Context
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.internal.featureflags.ReactNativeNewArchitectureFeatureFlags
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Runs a JS headless task (registered with AppRegistry.registerHeadlessTask) from a WorkManager
 * worker or a network callback, without a service: the worker's own time (up to 10 minutes) keeps
 * the process alive, so no foreground service has to start from the background (Android 12+
 * refuses that). Starts React if the app isn't running, as HeadlessJsTaskService does.
 */
object HeadlessRunner {
  private const val TAG = "SidekickHeadless"

  @Suppress("DEPRECATION")
  private fun reactContext(app: ReactApplication): ReactContext? =
    if (ReactNativeNewArchitectureFeatureFlags.enableBridgelessArchitecture()) app.reactHost?.currentReactContext
    else app.reactNativeHost.reactInstanceManager.currentReactContext

  @Suppress("DEPRECATION")
  private fun withReact(app: ReactApplication, then: (ReactContext) -> Unit) {
    reactContext(app)?.let { return then(it) }
    if (ReactNativeNewArchitectureFeatureFlags.enableBridgelessArchitecture()) {
      val host = app.reactHost ?: return
      host.addReactInstanceEventListener(
        object : ReactInstanceEventListener {
          override fun onReactContextInitialized(context: ReactContext) {
            host.removeReactInstanceEventListener(this)
            then(context)
          }
        }
      )
      host.start()
    } else {
      val m = app.reactNativeHost.reactInstanceManager
      m.addReactInstanceEventListener(
        object : ReactInstanceEventListener {
          override fun onReactContextInitialized(context: ReactContext) {
            m.removeReactInstanceEventListener(this)
            then(context)
          }
        }
      )
      m.createReactContextInBackground()
    }
  }

  /** Runs [task] with {payload}; returns when it finishes (true) or after [timeoutMs] (false). */
  suspend fun run(ctx: Context, task: String, payload: String, timeoutMs: Long): Boolean {
    val app = ctx.applicationContext as? ReactApplication ?: return false
    val done = CompletableDeferred<Boolean>()
    UiThreadUtil.runOnUiThread {
      try {
        withReact(app) { rc ->
          UiThreadUtil.runOnUiThread {
            try {
              val tasks = HeadlessJsTaskContext.getInstance(rc)
              val data = Arguments.createMap().apply { putString("payload", payload) }
              var id = -1
              tasks.addTaskEventListener(
                object : HeadlessJsTaskEventListener {
                  override fun onHeadlessJsTaskStart(taskId: Int) {}

                  override fun onHeadlessJsTaskFinish(taskId: Int) {
                    if (taskId != id) return
                    tasks.removeTaskEventListener(this)
                    done.complete(true)
                  }
                }
              )
              id = tasks.startTask(HeadlessJsTaskConfig(task, data, timeoutMs, true))
            } catch (e: Exception) {
              Log.w(TAG, "task $task failed to start", e)
              done.complete(false)
            }
          }
        }
      } catch (e: Exception) {
        Log.w(TAG, "React start failed", e)
        done.complete(false)
      }
    }
    return withTimeoutOrNull(timeoutMs + 5_000) { done.await() } ?: false
  }
}
