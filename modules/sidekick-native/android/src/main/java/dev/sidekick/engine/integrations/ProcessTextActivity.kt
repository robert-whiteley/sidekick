package dev.sidekick.engine.integrations

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import java.lang.ref.WeakReference

/**
 * "Sidekick" in the text selection menu of any app (Android PROCESS_TEXT). An invisible step in
 * the other app's task: it hands the selected text to the main Sidekick screen (which runs the
 * chat UI, the same on every phone) and waits there. When the user picks "Replace in the app",
 * [complete] returns the new text to the app that asked (only when its text is editable) and
 * goes back to it. Coming back to this step any other way (Back, Recents) just closes it.
 */
class ProcessTextActivity : Activity() {
  private var handedOver = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    handedOver = savedInstanceState?.getBoolean(KEY_HANDED) ?: false
    if (handedOver) return
    val text = intent?.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()
    val main = packageManager.getLaunchIntentForPackage(packageName)
    if (text.isNullOrBlank() || main == null) {
      finish()
      return
    }
    current = WeakReference(this)
    main.action = PhoneExtras.ACTION_PROCESS_TEXT
    main.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    main.putExtra(Intent.EXTRA_PROCESS_TEXT, text)
    main.putExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, intent.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, false))
    handedOver = true
    startActivity(main)
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.putBoolean(KEY_HANDED, handedOver)
  }

  private var resumedOnce = false

  override fun onResume() {
    super.onResume()
    // The first resume is the hand-over itself; a later one means the user came back here
    // without replacing anything.
    if (resumedOnce) finish() else resumedOnce = true
  }

  override fun onDestroy() {
    if (current?.get() === this) current = null
    super.onDestroy()
  }

  companion object {
    private const val KEY_HANDED = "handedOver"
    @Volatile private var current: WeakReference<ProcessTextActivity>? = null

    /** Whether an app is waiting for text back (its selection was editable and it is still there). */
    fun waiting(): Boolean = current?.get()?.let { !it.isFinishing } ?: false

    /**
     * Returns [text] to the app that asked (null: nothing changes) and takes the user back to it
     * from [sidekick] (the main screen). False if that app is no longer waiting.
     */
    fun complete(text: String?, sidekick: Activity?): Boolean {
      val a = current?.get() ?: return false
      current = null
      a.runOnUiThread {
        if (text != null) a.setResult(RESULT_OK, Intent().putExtra(Intent.EXTRA_PROCESS_TEXT, text))
        a.finish()
        sidekick?.moveTaskToBack(true)
      }
      return true
    }
  }
}
