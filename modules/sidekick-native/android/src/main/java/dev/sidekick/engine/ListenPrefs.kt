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

/**
 * The owner's voiceprint (centroid), pushed from JS (src/memory/store.ts) whenever it changes and
 * at start, and kept so the listen service has it without JS. A voiceprint is biometric data, so
 * it is stored encrypted (AES-GCM, key held in the Android Keystore, never leaves the phone).
 * Only the owner may interrupt Sidekick (OwnerBarge); null means not known yet (anyone may).
 */
object OwnerVoice {
  private const val KEY = "listen.ownerVoice.enc"
  private const val OLD_PLAIN_KEY = "listen.ownerVoice"
  private const val ALIAS = "sidekick.ownerVoice"
  @Volatile private var loaded = false
  @Volatile var centroid: FloatArray? = null
    private set

  fun set(ctx: Context, voice: FloatArray?) {
    centroid = voice?.takeIf { it.isNotEmpty() }
    loaded = true
    val enc = centroid?.let { runCatching { encrypt(it.joinToString(",")) }.getOrNull() }
    prefs(ctx).edit().remove(OLD_PLAIN_KEY).apply { enc?.let { putString(KEY, it) } ?: remove(KEY) }.apply()
  }

  /** Reads the saved voice once per process (JS may have set a newer one already). */
  fun load(ctx: Context) {
    if (loaded) return
    loaded = true
    val p = prefs(ctx)
    // Written in plain text by an earlier build: drop it (JS pushes the voice again at start).
    if (p.contains(OLD_PLAIN_KEY)) p.edit().remove(OLD_PLAIN_KEY).apply()
    centroid =
      p.getString(KEY, null)?.let { s ->
        runCatching { decrypt(s).split(",").map { it.toFloat() }.toFloatArray() }.getOrNull()
      }
  }

  private fun prefs(ctx: Context) = ctx.getSharedPreferences("sidekick", Context.MODE_PRIVATE)

  private fun key(): javax.crypto.SecretKey {
    val ks = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getKey(ALIAS, null) as? javax.crypto.SecretKey)?.let { return it }
    val gen = javax.crypto.KeyGenerator.getInstance(android.security.keystore.KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      android.security.keystore.KeyGenParameterSpec
        .Builder(ALIAS, android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
        .build()
    )
    return gen.generateKey()
  }

  private fun encrypt(plain: String): String {
    val c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
    c.init(javax.crypto.Cipher.ENCRYPT_MODE, key())
    val b64 = android.util.Base64.NO_WRAP
    return android.util.Base64.encodeToString(c.iv, b64) + ":" +
      android.util.Base64.encodeToString(c.doFinal(plain.toByteArray()), b64)
  }

  private fun decrypt(s: String): String {
    val (iv, data) = s.split(":").map { android.util.Base64.decode(it, android.util.Base64.NO_WRAP) }
    val c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
    c.init(javax.crypto.Cipher.DECRYPT_MODE, key(), javax.crypto.spec.GCMParameterSpec(128, iv))
    return String(c.doFinal(data))
  }
}
