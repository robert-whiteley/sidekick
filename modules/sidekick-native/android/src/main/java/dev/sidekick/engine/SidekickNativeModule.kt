package dev.sidekick.engine

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class LlmCandidateRecord : Record {
  @Field val modelPath: String = ""
  @Field val backend: String = "cpu"
}

class GenerateOptionsRecord : Record {
  @Field val maxTokens: Int? = null
  @Field val keepHistory: Boolean = false
  @Field val system: String? = null
}

class SidekickNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No React context")

  private val prefs by lazy { context.getSharedPreferences("sidekick", Context.MODE_PRIVATE) }

  private val downloads by lazy { Downloads(context) }

  private val llm by lazy {
    LlmEngine(context.cacheDir.absolutePath, context.applicationInfo.nativeLibraryDir)
  }

  override fun definition() = ModuleDefinition {
    Name("SidekickNative")

    Events("onLlmText")

    Function("getDeviceInfo") {
      val mem = ActivityManager.MemoryInfo()
      (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(mem)
      mapOf(
        "manufacturer" to Build.MANUFACTURER,
        "model" to Build.MODEL,
        "soc" to if (Build.VERSION.SDK_INT >= 31) "${Build.SOC_MANUFACTURER} ${Build.SOC_MODEL}" else Build.HARDWARE,
        "totalRamMb" to mem.totalMem / (1024 * 1024),
        "filesDir" to context.filesDir.absolutePath,
        "externalFilesDir" to context.getExternalFilesDir(null)?.absolutePath,
      )
    }

    AsyncFunction("llmLoad") { candidates: List<LlmCandidateRecord> ->
      val r = llm.load(candidates.map { LlmCandidate(it.modelPath, it.backend) })
      mapOf("modelPath" to r.modelPath, "backend" to r.backend, "initMs" to r.initMs, "failures" to r.failures)
    }

    AsyncFunction("llmGenerate") {
      requestId: String,
      prompt: String,
      imagePath: String?,
      opts: GenerateOptionsRecord?,
      promise: Promise ->
      llm.generate(
        prompt,
        imagePath,
        GenerateOptions(opts?.maxTokens, opts?.keepHistory ?: false, opts?.system),
        onText = { sendEvent("onLlmText", mapOf("requestId" to requestId, "text" to it)) },
        onFinish = { s ->
          promise.resolve(
            mapOf(
              "ttftMs" to s.ttftMs,
              "prefillTokens" to s.prefillTokens,
              "prefillTokensPerSec" to s.prefillTokensPerSec,
              "decodeTokens" to s.decodeTokens,
              "decodeTokensPerSec" to s.decodeTokensPerSec,
              "totalMs" to s.totalMs,
            )
          )
        },
        onFail = { promise.reject(CodedException("ERR_LLM", it.message ?: "Generation failed", it)) },
      )
    }

    // Small key/value settings (backend choice, toggles). Not for secrets.
    Function("kvGet") { key: String -> prefs.getString(key, null) }

    Function("kvSet") { key: String, value: String? ->
      prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }

    Function("downloadStart") { url: String, destPath: String, title: String, wifiOnly: Boolean ->
      downloads.start(url, destPath, title, wifiOnly).toDouble()
    }

    Function("downloadStatus") { id: Double -> downloads.status(id.toLong()) }

    Function("downloadCancel") { id: Double -> downloads.cancel(id.toLong()) }

    // Hashing GBs takes seconds, so it runs off the JS thread.
    AsyncFunction("downloadFinish") { destPath: String, sha256: String -> downloads.finish(destPath, sha256) }

    Function("fileExists") { path: String -> java.io.File(path).isFile }

    Function("llmCancel") { llm.cancel() }

    AsyncFunction("llmUnload") { llm.unload() }

    OnDestroy { llm.unload() }
  }
}
