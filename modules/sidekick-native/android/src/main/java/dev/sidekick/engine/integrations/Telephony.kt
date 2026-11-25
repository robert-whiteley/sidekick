package dev.sidekick.engine.integrations

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.CallLog
import android.provider.ContactsContract
import android.provider.Telephony
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import dev.sidekick.engine.EntryPoints
import org.json.JSONArray
import org.json.JSONObject

/**
 * Texts (SMS) and call history, only while Sidekick is the phone's default digital assistant.
 * Google Play allows the SMS and Call Log permissions for the "Default Assistant handler" and
 * requires the app to stop using them the moment it isn't the default any more, so every call
 * checks the role first. Read only when the user asks (or a routine they made asks); nothing is
 * copied into Sidekick's memory. JS: src/integrations/sms.ts, calllog.ts.
 */
object Telephony {
  fun isAssistant(ctx: Context): Boolean = EntryPoints.isDefaultAssistant(ctx)

  private fun granted(ctx: Context, perm: String) =
    ContextCompat.checkSelfPermission(ctx, perm) == PackageManager.PERMISSION_GRANTED

  /** JSON {assistant, readSms, sendSms, callLog}: what may be used right now. */
  fun status(ctx: Context): String {
    val a = isAssistant(ctx)
    return JSONObject()
      .put("assistant", a)
      .put("readSms", a && granted(ctx, Manifest.permission.READ_SMS))
      .put("sendSms", a && granted(ctx, Manifest.permission.SEND_SMS))
      .put("callLog", a && granted(ctx, Manifest.permission.READ_CALL_LOG))
      .toString()
  }

  private fun canRead(ctx: Context) = isAssistant(ctx) && granted(ctx, Manifest.permission.READ_SMS)

  private fun contactName(ctx: Context, number: String, cache: MutableMap<String, String?>): String? {
    if (number.isBlank()) return null
    cache[number]?.let { return it }
    if (cache.containsKey(number)) return null
    var name: String? = null
    if (granted(ctx, Manifest.permission.READ_CONTACTS)) {
      try {
        val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
        ctx.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use {
          if (it.moveToFirst()) name = it.getString(0)
        }
      } catch (e: Exception) {
        android.util.Log.w("SidekickTelephony", "lookup failed", e)
      }
    }
    cache[number] = name
    return name
  }

  /**
   * Texts since [fromMs] (newest first, at most [max]), inbox and sent. JSON
   * [{address, name, body, at, sent, read}]; "[]" when not allowed. [address] filters to numbers
   * whose last 8 digits match one of the comma-separated numbers ("" = all).
   */
  fun readSms(ctx: Context, fromMs: Double, toMs: Double, max: Int, address: String): String {
    val out = JSONArray()
    if (!canRead(ctx)) return out.toString()
    val wanted = address.split(',').map { tail(it) }.filter { it.isNotEmpty() }
    val names = mutableMapOf<String, String?>()
    try {
      ctx.contentResolver.query(
        Telephony.Sms.CONTENT_URI,
        arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE, Telephony.Sms.TYPE, Telephony.Sms.READ),
        "${Telephony.Sms.DATE} >= ? AND ${Telephony.Sms.DATE} <= ? AND ${Telephony.Sms.TYPE} IN (1, 2)",
        arrayOf(fromMs.toLong().toString(), toMs.toLong().toString()),
        "${Telephony.Sms.DATE} DESC",
      )?.use { c ->
        while (c.moveToNext() && out.length() < max.coerceIn(1, 200)) {
          val addr = c.getString(0) ?: ""
          if (wanted.isNotEmpty() && wanted.none { it == tail(addr) }) continue
          out.put(
            JSONObject()
              .put("address", addr)
              .put("name", contactName(ctx, addr, names) ?: JSONObject.NULL)
              .put("body", (c.getString(1) ?: "").take(2000))
              .put("at", c.getLong(2).toDouble())
              .put("sent", c.getInt(3) == 2)
              .put("read", c.getInt(4) == 1),
          )
        }
      }
    } catch (e: Exception) {
      android.util.Log.w("SidekickTelephony", "sms read failed", e)
    }
    return out.toString()
  }

  /** Sends a text straight away (split into parts if long). False when not allowed or it failed. */
  fun sendSms(ctx: Context, number: String, text: String): Boolean {
    if (!isAssistant(ctx) || !granted(ctx, Manifest.permission.SEND_SMS)) return false
    if (number.isBlank() || text.isBlank()) return false
    return try {
      val sms =
        if (Build.VERSION.SDK_INT >= 31) ctx.getSystemService(SmsManager::class.java)
        else @Suppress("DEPRECATION") SmsManager.getDefault()
      val parts = sms.divideMessage(text)
      if (parts.size > 1) sms.sendMultipartTextMessage(number, null, parts, null, null)
      else sms.sendTextMessage(number, null, text, null, null)
      true
    } catch (e: Exception) {
      android.util.Log.w("SidekickTelephony", "sms send failed", e)
      false
    }
  }

  /** Calls since [fromMs], newest first. JSON [{number, name, type, at, seconds}]; type is
   * incoming / outgoing / missed / rejected / blocked / voicemail. "[]" when not allowed. */
  fun callLog(ctx: Context, fromMs: Double, toMs: Double, max: Int): String {
    val out = JSONArray()
    if (!isAssistant(ctx) || !granted(ctx, Manifest.permission.READ_CALL_LOG)) return out.toString()
    val names = mutableMapOf<String, String?>()
    try {
      ctx.contentResolver.query(
        CallLog.Calls.CONTENT_URI,
        arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.CACHED_NAME, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION),
        "${CallLog.Calls.DATE} >= ? AND ${CallLog.Calls.DATE} <= ?",
        arrayOf(fromMs.toLong().toString(), toMs.toLong().toString()),
        "${CallLog.Calls.DATE} DESC",
      )?.use { c ->
        while (c.moveToNext() && out.length() < max.coerceIn(1, 200)) {
          val number = c.getString(0) ?: ""
          val type = when (c.getInt(2)) {
            CallLog.Calls.INCOMING_TYPE -> "incoming"
            CallLog.Calls.OUTGOING_TYPE -> "outgoing"
            CallLog.Calls.MISSED_TYPE -> "missed"
            CallLog.Calls.REJECTED_TYPE -> "rejected"
            CallLog.Calls.BLOCKED_TYPE -> "blocked"
            CallLog.Calls.VOICEMAIL_TYPE -> "voicemail"
            else -> "other"
          }
          out.put(
            JSONObject()
              .put("number", number)
              .put("name", c.getString(1)?.takeIf { it.isNotBlank() } ?: contactName(ctx, number, names) ?: JSONObject.NULL)
              .put("type", type)
              .put("at", c.getLong(3).toDouble())
              .put("seconds", c.getLong(4).toDouble()),
          )
        }
      }
    } catch (e: Exception) {
      android.util.Log.w("SidekickTelephony", "call log read failed", e)
    }
    return out.toString()
  }

  /** The last 8 digits: enough to match "+44 7700 900123" with "07700900123". */
  fun tail(number: String): String = number.filter { it.isDigit() }.takeLast(8)
}
