package dev.sidekick.engine.offline

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS: src/engine/online-queue.ts and src/engine/geo.ts. */
class OfflineModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No React context")

  override fun definition() = ModuleDefinition {
    Name("SidekickOffline")
    OnCreate { appContext.reactContext?.let { Offline.watch(it) } }
    Function("configure") { json: String -> Offline.configure(context, json) }
    Function("markSent") { online: Boolean, wifi: Boolean -> Offline.markSent(context, online, wifi) }
    Function("state") {
      val s = Offline.state(context)
      mapOf("online" to s.online, "wifi" to s.wifi)
    }
    /** The offline place-name pack (assets/geo/places500.bin), ~5 MB, read once by JS. */
    Function("geoPack") {
      try {
        context.assets.open("geo/places500.bin").use { it.readBytes() }
      } catch (e: Exception) {
        null
      }
    }
  }
}
