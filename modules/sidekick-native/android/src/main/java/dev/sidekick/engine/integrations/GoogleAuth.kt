package dev.sidekick.engine.integrations

import android.app.Activity
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope
import expo.modules.kotlin.Promise

/**
 * Google's Authorization API, one scope at a time (incremental): gmail.send, tasks, drive.file.
 * The first call for a scope shows Google's consent screen for just that scope; later calls
 * return a fresh access token silently. Works only once the owner's Android OAuth client
 * (package name + signing SHA-1) exists in Google Cloud; JS stays inactive until then (ADR 0008).
 */
object GoogleAuth {
  val ALLOWED = setOf(
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/tasks",
    "https://www.googleapis.com/auth/drive.file",
  )
  const val REQUEST_CODE = 0x5e1d

  @Volatile private var pending: Promise? = null

  fun authorize(activity: Activity, scopes: List<String>, promise: Promise) {
    if (scopes.isEmpty() || !ALLOWED.containsAll(scopes)) {
      promise.reject("E_GOOGLE_SCOPE", "Scope not allowed", null)
      return
    }
    val request = AuthorizationRequest.Builder().setRequestedScopes(scopes.map { Scope(it) }).build()
    Identity.getAuthorizationClient(activity)
      .authorize(request)
      .addOnSuccessListener { r ->
        val pi = r.pendingIntent
        if (r.hasResolution() && pi != null) {
          pending?.reject("E_GOOGLE_CANCELLED", "Replaced by a newer sign-in", null)
          pending = promise
          try {
            activity.startIntentSenderForResult(pi.intentSender, REQUEST_CODE, null, 0, 0, 0, null)
          } catch (e: Exception) {
            pending = null
            promise.reject("E_GOOGLE_UI", e.message ?: "Couldn't open Google sign-in", e)
          }
        } else {
          val token = r.accessToken
          if (token != null) promise.resolve(token) else promise.reject("E_GOOGLE_TOKEN", "No token", null)
        }
      }
      .addOnFailureListener { e -> promise.reject("E_GOOGLE_AUTH", e.message ?: "Google sign-in failed", e) }
  }

  fun onActivityResult(activity: Activity, requestCode: Int, data: android.content.Intent?) {
    if (requestCode != REQUEST_CODE) return
    val p = pending ?: return
    pending = null
    try {
      val r = Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data)
      val token = r.accessToken
      if (token != null) p.resolve(token) else p.reject("E_GOOGLE_TOKEN", "No token", null)
    } catch (e: ApiException) {
      p.reject("E_GOOGLE_CANCELLED", "Google sign-in was cancelled", e)
    }
  }

  fun clearToken(activity: Activity, token: String, promise: Promise) {
    Identity.getAuthorizationClient(activity)
      .clearToken(ClearTokenRequest.builder().setToken(token).build())
      .addOnSuccessListener { promise.resolve(null) }
      .addOnFailureListener { promise.resolve(null) }
  }
}
