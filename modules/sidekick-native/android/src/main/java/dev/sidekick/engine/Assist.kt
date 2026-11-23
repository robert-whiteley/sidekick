package dev.sidekick.engine

import android.app.assist.AssistContent
import android.app.assist.AssistStructure
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import android.text.InputType
import android.util.Log
import org.json.JSONObject
import java.io.File

/**
 * Lets Sidekick be the phone's digital assistant (Settings > Apps > Default apps > Digital
 * assistant app). Long-press home / corner swipe opens [AssistSession], which receives the
 * screenshot and the screen's text, stores them for the app and opens the Ask screen.
 */
class AssistService : VoiceInteractionService()

class AssistSessionService : VoiceInteractionSessionService() {
  override fun onNewSession(args: Bundle?): VoiceInteractionSession = AssistSession(this)
}

class AssistSession(context: Context) : VoiceInteractionSession(context) {
  private val main = Handler(Looper.getMainLooper())
  private val text = StringBuilder()
  private var shot: String? = null
  private var wantShot = false
  private var wantAssist = false
  private var gotShot = false
  private var gotAssist = false
  private var launched = false
  private val launchNow = Runnable { launch() }

  override fun onShow(args: Bundle?, showFlags: Int) {
    super.onShow(args, showFlags)
    reset()
    wantAssist = showFlags and SHOW_WITH_ASSIST != 0
    wantShot = showFlags and SHOW_WITH_SCREENSHOT != 0
    // Neither arrives if the user turned them off or the app on screen is secure: go anyway.
    main.postDelayed(launchNow, if (wantAssist || wantShot) FALLBACK_MS else 0)
  }

  // Still called on every version by the default onHandleAssist(AssistState).
  @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
  override fun onHandleAssist(data: Bundle?, structure: AssistStructure?, content: AssistContent?) {
    structure?.let { collectText(it) }
    gotAssist = true
    maybeLaunch()
  }

  // Still called on every version by the default onHandleAssist(AssistState).
  @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
  override fun onHandleAssistSecondary(
    data: Bundle?,
    structure: AssistStructure?,
    content: AssistContent?,
    index: Int,
    count: Int,
  ) {
    structure?.let { collectText(it) }
    maybeLaunch()
  }

  override fun onHandleScreenshot(screenshot: Bitmap?) {
    shot = screenshot?.let { saveShot(it) }
    gotShot = true
    maybeLaunch()
  }

  override fun onHide() {
    super.onHide()
    main.removeCallbacks(launchNow)
  }

  private fun reset() {
    main.removeCallbacks(launchNow)
    text.setLength(0)
    shot = null
    gotShot = false
    gotAssist = false
    launched = false
  }

  private fun maybeLaunch() {
    if ((gotShot || !wantShot) && (gotAssist || !wantAssist)) {
      // Secondary windows' text follows shortly after; wait a moment for it.
      main.removeCallbacks(launchNow)
      main.postDelayed(launchNow, SETTLE_MS)
    }
  }

  private fun launch() {
    if (launched) return
    launched = true
    val grab = JSONObject()
      .put("shot", shot ?: JSONObject.NULL)
      .put("text", text.toString().take(MAX_TEXT))
      .put("at", System.currentTimeMillis())
    context.getSharedPreferences("sidekick", Context.MODE_PRIVATE)
      .edit().putString(ASSIST_KEY, grab.toString()).apply()
    try {
      // A bound VoiceInteractionService may start activities from the background.
      context.startActivity(EntryLinks.intent(context, EntryLinks.SCREEN))
    } catch (e: Exception) {
      Log.w(TAG, "could not open Sidekick", e)
    }
    hide()
  }

  private fun collectText(structure: AssistStructure) {
    for (w in 0 until structure.windowNodeCount) walk(structure.getWindowNodeAt(w).rootViewNode, 0)
  }

  private fun walk(node: AssistStructure.ViewNode?, depth: Int) {
    if (node == null || depth > 64 || text.length >= MAX_TEXT) return
    if (!isPassword(node)) {
      val t = node.text?.toString()?.trim()
      if (!t.isNullOrEmpty()) text.append(t).append('\n')
    }
    for (i in 0 until node.childCount) walk(node.getChildAt(i), depth + 1)
  }

  private fun isPassword(node: AssistStructure.ViewNode): Boolean {
    if (Build.VERSION.SDK_INT < 28) return false
    val v = node.inputType and InputType.TYPE_MASK_VARIATION
    val cls = node.inputType and InputType.TYPE_MASK_CLASS
    return (cls == InputType.TYPE_CLASS_TEXT &&
      (v == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
        v == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
        v == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD)) ||
      (cls == InputType.TYPE_CLASS_NUMBER && v == InputType.TYPE_NUMBER_VARIATION_PASSWORD)
  }

  private fun saveShot(bitmap: Bitmap): String? = try {
    val dir = File(context.cacheDir, "assist").apply { mkdirs() }
    // Keep only the last few: the app copies a screenshot when the user saves it.
    dir.listFiles()?.sortedByDescending { it.lastModified() }?.drop(KEEP_SHOTS - 1)?.forEach { it.delete() }
    val file = File(dir, "shot-${System.currentTimeMillis()}.jpg")
    val bmp =
      if (Build.VERSION.SDK_INT >= 26 && bitmap.config == Bitmap.Config.HARDWARE) {
        bitmap.copy(Bitmap.Config.ARGB_8888, false)
      } else bitmap
    file.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 85, it) }
    file.absolutePath
  } catch (e: Exception) {
    Log.w(TAG, "screenshot not saved", e)
    null
  }

  companion object {
    private const val TAG = "SidekickAssist"
    /** Read by src/engine/entry-points.ts (ASSIST_KEY). */
    const val ASSIST_KEY = "assist.last"
    private const val FALLBACK_MS = 2500L
    private const val SETTLE_MS = 250L
    private const val MAX_TEXT = 6000
    private const val KEEP_SHOTS = 3
  }
}
