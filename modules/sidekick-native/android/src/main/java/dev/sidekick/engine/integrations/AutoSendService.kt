package dev.sidekick.engine.integrations

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Direct-download ("full") build only: after the user approved a message in Sidekick and it
 * opened in WhatsApp with the text ready, this presses WhatsApp's Send button once. It is armed
 * for one package for a few seconds per approved message and does nothing otherwise; it reads
 * no screen content beyond finding that button. Declared only in the full manifest
 * (plugins/with-flavours.js), limited to WhatsApp's packages in res/xml/sidekick_autosend.xml.
 */
class AutoSendService : AccessibilityService() {
  companion object {
    @Volatile private var armedPkg: String? = null
    @Volatile private var deadline = 0L
    @Volatile var connected = false
      private set

    fun arm(pkg: String, timeoutMs: Long) {
      armedPkg = pkg
      deadline = System.currentTimeMillis() + timeoutMs
    }

    fun enabled(ctx: Context): Boolean {
      if (Flavour.get(ctx) != "full") return false
      val list = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
      return list.split(':').any { it.startsWith(ctx.packageName + "/") && it.endsWith("AutoSendService") }
    }

    fun openSettings(ctx: Context) {
      ctx.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private val SEND_LABELS = setOf("send", "senden", "envoyer", "enviar", "invia", "verzenden", "wyślij")

    /** WhatsApp's send button: its view id, else a clickable node labelled "Send". */
    fun findSend(root: AccessibilityNodeInfo, pkg: String): AccessibilityNodeInfo? {
      root.findAccessibilityNodeInfosByViewId("$pkg:id/send").firstOrNull { it.isClickable && it.isEnabled }?.let { return it }
      val queue = ArrayDeque<AccessibilityNodeInfo>().apply { add(root) }
      var seen = 0
      while (queue.isNotEmpty() && seen++ < 400) {
        val n = queue.removeFirst()
        val label = (n.contentDescription ?: n.text)?.toString()?.trim()?.lowercase()
        if (label != null && label in SEND_LABELS && n.isClickable && n.isEnabled) return n
        for (i in 0 until n.childCount) n.getChild(i)?.let { queue.add(it) }
      }
      return null
    }
  }

  override fun onServiceConnected() {
    connected = true
  }

  override fun onUnbind(intent: Intent?): Boolean {
    connected = false
    return super.onUnbind(intent)
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    val pkg = armedPkg ?: return
    if (System.currentTimeMillis() > deadline) {
      armedPkg = null
      return
    }
    if (event?.packageName?.toString() != pkg) return
    val root = rootInActiveWindow ?: return
    val send = findSend(root, pkg) ?: return
    if (send.performAction(AccessibilityNodeInfo.ACTION_CLICK)) armedPkg = null
  }

  override fun onInterrupt() {}
}
