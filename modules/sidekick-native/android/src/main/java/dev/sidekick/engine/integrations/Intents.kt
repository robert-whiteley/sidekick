package dev.sidekick.engine.integrations

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.AlarmClock
import androidx.core.content.ContextCompat

/**
 * Hand-offs to other apps through standard Android intents: alarms and timers (Clock), calls,
 * directions, and messages opened with the text ready. Nothing here sends anything by itself.
 */
object Intents {
  val PACKAGES = mapOf(
    "whatsapp" to listOf("com.whatsapp", "com.whatsapp.w4b"),
    "telegram" to listOf("org.telegram.messenger", "org.telegram.messenger.web"),
    "signal" to listOf("org.thoughtcrime.securesms"),
  )

  private fun start(ctx: Context, activity: Activity?, intent: Intent): Boolean {
    return try {
      if (activity != null) activity.startActivity(intent)
      else ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (e: ActivityNotFoundException) {
      false
    } catch (e: SecurityException) {
      false
    }
  }

  fun isInstalled(ctx: Context, pkg: String): Boolean =
    try {
      ctx.packageManager.getPackageInfo(pkg, 0)
      true
    } catch (e: PackageManager.NameNotFoundException) {
      false
    }

  fun setAlarm(ctx: Context, activity: Activity?, hour: Int, minute: Int, label: String): Boolean {
    val i = Intent(AlarmClock.ACTION_SET_ALARM)
      .putExtra(AlarmClock.EXTRA_HOUR, hour)
      .putExtra(AlarmClock.EXTRA_MINUTES, minute)
      .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
    if (label.isNotBlank()) i.putExtra(AlarmClock.EXTRA_MESSAGE, label)
    return start(ctx, activity, i)
  }

  fun setTimer(ctx: Context, activity: Activity?, seconds: Int, label: String): Boolean {
    val i = Intent(AlarmClock.ACTION_SET_TIMER)
      .putExtra(AlarmClock.EXTRA_LENGTH, seconds.coerceIn(1, 86_400))
      .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
    if (label.isNotBlank()) i.putExtra(AlarmClock.EXTRA_MESSAGE, label)
    return start(ctx, activity, i)
  }

  /**
   * "Cancel the timer": Android has no intent to cancel a running timer, only to dismiss ringing
   * ones (API 28+, a no-op when none rings), so the Clock's timers are opened after it.
   */
  fun cancelTimer(ctx: Context, activity: Activity?): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
      start(ctx, activity, Intent(AlarmClock.ACTION_DISMISS_TIMER))
    return start(ctx, activity, Intent(AlarmClock.ACTION_SHOW_TIMERS))
  }

  fun call(ctx: Context, activity: Activity?, number: String, direct: Boolean): Boolean {
    val uri = Uri.fromParts("tel", number, null)
    val canCall = direct &&
      ContextCompat.checkSelfPermission(ctx, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED
    return start(ctx, activity, Intent(if (canCall) Intent.ACTION_CALL else Intent.ACTION_DIAL, uri))
  }

  private const val GOOGLE_MAPS = "com.google.android.apps.maps"
  private const val WAZE = "com.waze"

  fun navigate(ctx: Context, activity: Activity?, destination: String, mode: String): Boolean {
    val q = Uri.encode(destination)
    if (mode != "transit") {
      val m = when (mode) { "walking" -> "w"; "cycling" -> "b"; else -> "d" }
      val nav = Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=$q&mode=$m")).setPackage(GOOGLE_MAPS)
      if (start(ctx, activity, nav)) return true
    } else {
      val dir = Intent(
        Intent.ACTION_VIEW,
        Uri.parse("https://www.google.com/maps/dir/?api=1&destination=$q&travelmode=transit"),
      ).setPackage(GOOGLE_MAPS)
      if (start(ctx, activity, dir)) return true
    }
    // No Google Maps: Waze starts driving directions straight away.
    if (mode == "driving" || mode == "") {
      val waze = Intent(Intent.ACTION_VIEW, Uri.parse("https://waze.com/ul?q=$q&navigate=yes")).setPackage(WAZE)
      if (start(ctx, activity, waze)) return true
    }
    // Any maps app.
    return start(ctx, activity, Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=$q")))
  }

  /** wa.me wants the full international number, digits only. */
  fun waDigits(number: String): String = number.filter { it.isDigit() }

  fun openMessage(ctx: Context, activity: Activity?, app: String, number: String?, text: String): Boolean {
    when (app) {
      "sms" -> {
        val uri = Uri.parse("smsto:" + (number?.let { Uri.encode(it) } ?: ""))
        return start(ctx, activity, Intent(Intent.ACTION_SENDTO, uri).putExtra("sms_body", text))
      }
      "whatsapp" -> {
        for (pkg in PACKAGES.getValue("whatsapp")) {
          val i =
            if (number != null) {
              Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/${waDigits(number)}?text=${Uri.encode(text)}"))
            } else {
              Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
            }
          if (start(ctx, activity, i.setPackage(pkg))) return true
        }
        return false
      }
      else -> {
        // Telegram and Signal: their share screen with the text; the user picks the chat.
        for (pkg in PACKAGES[app] ?: return false) {
          val i = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text).setPackage(pkg)
          if (start(ctx, activity, i)) return true
        }
        return false
      }
    }
  }
}

