package dev.sidekick.engine.routines

import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.os.Build
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS: src/engine/routines.ts. */
class RoutinesModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No React context")

  override fun definition() = ModuleDefinition {
    Name("SidekickRoutines")
    OnCreate { appContext.reactContext?.let { Routines.registerDynamic(it) } }
    Function("setPlan") { json: String -> Routines.setPlan(context, json) }
    Function("canExact") { Routines.canExact(context) }
    Function("openExactSettings") {
      if (Build.VERSION.SDK_INT >= 31) {
        context.startActivity(
          Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
      }
    }
  }
}
