package dev.sidekick.engine

import android.content.Context

/**
 * Listening settings saved natively, so a restarted listen service (app process killed, JS not
 * running) keeps the user's choices, e.g. "instructions only" stays on.
 */
object ListenPrefs {
  private const val PREFS = "sidekick"

  fun save(ctx: Context) {
    ctx
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString("listen.wakeKeywords", MicLoop.wakeKeywords)
      .putString("listen.wakePhrase", MicLoop.wakePhrase)
      .putBoolean("listen.recordAmbient", MicLoop.recordAmbient)
      .putBoolean("listen.jsAnswers", MicLoop.jsAnswers)
      .putBoolean("listen.commandsOnly", MicLoop.commandsOnly)
      .apply()
  }

  fun load(ctx: Context) {
    val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!p.contains("listen.recordAmbient")) return
    p.getString("listen.wakeKeywords", null)?.let { MicLoop.wakeKeywords = it }
    p.getString("listen.wakePhrase", null)?.let { MicLoop.wakePhrase = it }
    MicLoop.recordAmbient = p.getBoolean("listen.recordAmbient", MicLoop.recordAmbient)
    MicLoop.jsAnswers = p.getBoolean("listen.jsAnswers", MicLoop.jsAnswers)
    MicLoop.commandsOnly = p.getBoolean("listen.commandsOnly", MicLoop.commandsOnly)
  }
}
